/**
 * Hangman for a room. Everyone gets the same hidden word at the same moment
 * and guesses on a board of their own: a right letter shows wherever it
 * comes in the word, a wrong one draws another piece of your hangman, and
 * six wrong and you're hanged. You can have a go at the whole word whenever
 * you like, but a wrong go costs a piece, like a wrong letter. Every letter
 * you find scores a little; getting the word scores more the sooner you do
 * and the more of you is left. A word ends when everyone still here has it
 * or is hanged, or when time's up.
 *
 * Two ways to play. In a race, the game picks the words. Taking turns, each
 * word is picked by one of you, from three on offer, for everyone else to
 * guess, and whoever picked it scores for every piece the others lose.
 *
 * As with the other rooms (see lib/draw/room.ts), the server keeps a log of
 * what happened and this replays it. The words come from the room's secret
 * salt, so nobody can see what's coming, and nobody's view has the word in
 * it until it's over, apart from their own once they've got it.
 */

import { cleanName } from "../rooms/codes.ts";
import { seededRandom, type Random } from "../random.ts";
import { LIVES, WORDS, cleanGuess, cleanWord, lettersOf, maskOf, sameWord, type Word } from "./words.ts";

export type Mode = "race" | "turns";
export const MODES: readonly Mode[] = ["race", "turns"];

/** How long a game is: in a race, how many words; taking turns, how many each of you picks. */
export const ROUND_CHOICES = { race: [5, 10, 15], turns: [1, 2, 3] } as const satisfies Record<Mode, readonly number[]>;
export const DEFAULT_ROUNDS: Record<Mode, number> = { race: 10, turns: 2 };
/** Seconds for each word. */
export const TIME_CHOICES = [30, 60, 90] as const;

export interface Settings {
  mode: Mode;
  rounds: number;
  time: number;
  /** The host's own words. */
  words: string[];
  /** Only the host's own words, none of the built-in ones. */
  only: boolean;
}

export const DEFAULT_SETTINGS: Settings = { mode: "race", rounds: 10, time: 60, words: [], only: false };

export const COUNTDOWN_MS = 3000;
export const CHOOSE_MS = 15_000;
export const REVEAL_MS = 6000;
export const MAX_PLAYERS = 20;
/** Taking turns needs someone to pick and someone to guess. */
export const MIN_TURNS_PLAYERS = 2;
export const MAX_CUSTOM_WORDS = 200;
export const AWAY_MS = 30_000;
export const GONE_MS = 60_000;
export const MAX_EVENTS = 8000;
/** For each place a found letter comes in the word. */
export const LETTER_POINTS = 10;

export type HangEvent =
  | { k: "create"; t: number; code: string; salt: string; settings: Settings }
  | { k: "join"; t: number; p: string; name: string; tok: string }
  | { k: "leave"; t: number; p: string; why: "left" | "gone" | "kicked"; by?: string }
  | { k: "settings"; t: number; p: string; settings: Settings }
  | { k: "start"; t: number; p: string }
  | { k: "choose"; t: number; p: string; game: number; round: number; i: number }
  | { k: "guess"; t: number; p: string; game: number; round: number; g: string }
  | { k: "lobby"; t: number; p: string };

export interface Player {
  id: string;
  name: string;
  tok: string;
  seq: number;
  active: boolean;
  kicked: boolean;
  since: number;
}

/** One player's go at one word. */
export interface Board {
  /** Everything they tried, in order: single letters, and goes at the whole word. */
  guesses: string[];
  found: Set<string>;
  misses: number;
  /** How many of the word's letters they can see, counting a letter each place it comes. */
  shown: number;
  points: number;
  /** When they got it, or were hanged. */
  solved: number | null;
  hanged: number | null;
}

export interface Round {
  /** Whoever picked the word, taking turns; null in a race. */
  setter: string | null;
  options: Word[] | null;
  /** Null until it's picked. */
  word: Word | null;
  /** When guessing began. */
  starts: number | null;
  boards: Map<string, Board>;
  setterPoints: number;
}

export type Phase = "lobby" | "countdown" | "choosing" | "playing" | "reveal" | "final";
export type GamePhase = Exclude<Phase, "lobby">;

export interface Game {
  index: number;
  settings: Settings;
  phase: GamePhase;
  /** When the phase that's on ends. */
  ends: number;
  /** Every word so far, the one that's on last. */
  rounds: Round[];
  /** A race's words, picked at the start. */
  words: Word[];
  /** Taking turns: who picks this time round, in order; how far along it is; and which time round it is. */
  order: string[];
  position: number;
  pass: number;
  used: Set<string>;
  scores: Map<string, number>;
}

export interface Room {
  code: string;
  salt: string;
  settings: Settings;
  players: Map<string, Player>;
  host: string | null;
  game: Game | null;
  games: number;
  clock: number;
  version: number;
}

/* ----------------------------------------------------------- checking */

export function cleanSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const { mode, rounds, time, words, only } = value as Record<string, unknown>;
  if (!(MODES as readonly unknown[]).includes(mode)) return null;
  if (!(ROUND_CHOICES[mode as Mode] as readonly unknown[]).includes(rounds) || !(TIME_CHOICES as readonly unknown[]).includes(time)) return null;
  if (!Array.isArray(words) || words.length > MAX_CUSTOM_WORDS || typeof only !== "boolean") return null;
  const cleaned = [...new Set(words.map(cleanWord).filter((w): w is string => w !== null))];
  return { mode: mode as Mode, rounds: rounds as number, time: time as number, words: cleaned, only: only && cleaned.length >= 3 };
}

/** What getting the word is worth: more the sooner (`left` is the share of time left), and for every piece of you still to draw. */
export function solvePoints(left: number, lives: number): number {
  return Math.round(100 + 500 * Math.max(0, Math.min(1, left))) + 50 * Math.max(0, lives);
}

/** What picking a word is worth: for every piece the others lost on it, on average. */
export function setterPoints(misses: number, guessers: number): number {
  return guessers > 0 ? Math.round((100 * misses) / guessers) : 0;
}

/* ------------------------------------------------------------ replay */

const activePlayers = (room: Room) => [...room.players.values()].filter((p) => p.active).sort((a, b) => a.seq - b.seq);

function electHost(room: Room) {
  room.host = activePlayers(room)[0]?.id ?? null;
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const customWords = (settings: Settings): Word[] => settings.words.map((text) => ({ text, category: null }));

/** The built-in words, less any the host has too, so nothing comes up twice. */
const builtIn = (settings: Settings) => {
  const theirs = new Set(settings.words.map(lettersOf));
  return WORDS.filter((w) => !theirs.has(lettersOf(w.text)));
};

/**
 * A race's words, fixed by the salt. With the host's words mixed in, a
 * third of the game is theirs; with only theirs, the game is as long as
 * their list, if that's shorter, rather than show any twice.
 */
export function raceWords(salt: string, game: number, settings: Settings): Word[] {
  const random = seededRandom(`${salt}:words:${game}`);
  const theirs = shuffle(customWords(settings), random);
  if (settings.only) return theirs.slice(0, settings.rounds);
  const mine = Math.min(theirs.length, Math.ceil(settings.rounds / 3));
  const ours = shuffle(builtIn(settings), random).slice(0, settings.rounds - mine);
  return shuffle([...theirs.slice(0, mine), ...ours], random);
}

/** The three words a picker chooses from, fixed by the salt: three categories where it can, and none used yet this game. */
function optionsFor(room: Room, game: Game): Word[] {
  const custom = customWords(game.settings);
  const pool = game.settings.only ? custom : builtIn(game.settings);
  const random = seededRandom(`${room.salt}:options:${game.index}:${game.rounds.length}`);
  const picks: Word[] = [];
  const pick = (list: readonly Word[]) => {
    for (let tries = 0; tries < 60; tries++) {
      const word = list[Math.floor(random() * list.length)];
      if (picks.some((p) => p.text === word.text)) continue;
      if (game.used.has(word.text) && tries < 40) continue;
      if (word.category !== null && picks.some((p) => p.category === word.category) && tries < 20) continue;
      return word;
    }
    return list.find((w) => !picks.some((p) => p.text === w.text)) ?? list[0];
  };
  for (let i = 0; i < 3; i++) {
    // With words of their own and built-in ones mixed, one of the three is always one of theirs.
    const list = !game.settings.only && custom.length > 0 && i === 0 ? custom : pool;
    picks.push(pick(list));
  }
  return picks;
}

const current = (game: Game) => game.rounds[game.rounds.length - 1];

const done = (board: Board | undefined) => !!board && (board.solved !== null || board.hanged !== null);

function finish(game: Game, at: number) {
  game.phase = "final";
  game.ends = at;
}

function startGuessing(game: Game, round: Round, at: number) {
  game.phase = "playing";
  round.starts = at;
  game.ends = at + game.settings.time * 1000;
}

function choose(game: Game, round: Round, index: number, at: number) {
  round.word = round.options![index];
  game.used.add(round.word.text);
  startGuessing(game, round, at);
}

/** The next word: straight into guessing in a race; taking turns, whoever's next picks it. */
function nextRound(room: Room, game: Game, at: number) {
  if (game.settings.mode === "race") {
    if (game.rounds.length >= game.words.length) return finish(game, at);
    const round: Round = { setter: null, options: null, word: game.words[game.rounds.length], starts: null, boards: new Map(), setterPoints: 0 };
    game.rounds.push(round);
    return startGuessing(game, round, at);
  }
  for (;;) {
    if (activePlayers(room).length < MIN_TURNS_PLAYERS) return finish(game, at);
    while (game.position < game.order.length && !room.players.get(game.order[game.position])?.active) game.position++;
    if (game.position < game.order.length) break;
    if (game.pass >= game.settings.rounds) return finish(game, at);
    game.pass++;
    game.order = activePlayers(room).map((p) => p.id);
    game.position = 0;
  }
  const round: Round = { setter: game.order[game.position], options: null, word: null, starts: null, boards: new Map(), setterPoints: 0 };
  round.options = optionsFor(room, game);
  game.rounds.push(round);
  game.phase = "choosing";
  game.ends = at + CHOOSE_MS;
}

/** Stops the guessing. Whoever picked it scores for the pieces everyone lost, if they're still here to see it. */
function endRound(room: Room, game: Game, at: number) {
  const round = current(game);
  if (round.setter !== null) {
    const guessers = new Set([...round.boards.keys(), ...activePlayers(room).map((p) => p.id)]);
    guessers.delete(round.setter);
    const misses = [...round.boards.values()].reduce((sum, board) => sum + board.misses, 0);
    round.setterPoints = room.players.get(round.setter)?.active ? setterPoints(misses, guessers.size) : 0;
    game.scores.set(round.setter, (game.scores.get(round.setter) ?? 0) + round.setterPoints);
  }
  game.phase = "reveal";
  game.ends = at + REVEAL_MS;
}

/** Ends the word early once nobody still here is still trying. */
function settle(room: Room, game: Game, at: number) {
  if (game.phase !== "playing") return;
  const round = current(game);
  const trying = activePlayers(room).some((p) => p.id !== round.setter && !done(round.boards.get(p.id)));
  if (!trying) endRound(room, game, at);
}

/** Brings the room's timeline up to `t`: the countdown and choices run out, words end, the next begins. */
function advance(room: Room, t: number) {
  if (t > room.clock) room.clock = t;
  for (;;) {
    const game = room.game;
    if (!game || game.phase === "final" || room.clock < game.ends) return;
    if (game.phase === "countdown") nextRound(room, game, game.ends);
    // No choice in time means the first word.
    else if (game.phase === "choosing") choose(game, current(game), 0, game.ends);
    else if (game.phase === "playing") endRound(room, game, game.ends);
    else {
      game.position++;
      nextRound(room, game, game.ends);
    }
  }
}

function guess(room: Room, game: Game, player: Player, text: string, t: number) {
  const round = current(game);
  const word = round.word!.text;
  const board = round.boards.get(player.id) ?? { guesses: [], found: new Set<string>(), misses: 0, shown: 0, points: 0, solved: null, hanged: null };
  if (done(board)) return;
  const letter = text.length === 1;
  if (board.guesses.some((g) => (letter ? g === text : g.length > 1 && lettersOf(g) === lettersOf(text)))) return;
  board.guesses.push(text);
  round.boards.set(player.id, board);

  const before = board.shown;
  if (letter ? word.includes(text) : sameWord(text, word)) {
    for (const ch of letter ? text : lettersOf(word)) board.found.add(ch);
    board.shown = lettersOf(word).split("").filter((ch) => board.found.has(ch)).length;
  } else {
    board.misses++;
  }
  let points = LETTER_POINTS * (board.shown - before);
  if (board.shown === lettersOf(word).length) {
    board.solved = t;
    points += solvePoints((game.ends - t) / (game.settings.time * 1000), LIVES - board.misses);
  } else if (board.misses >= LIVES) {
    board.hanged = t;
  }
  board.points += points;
  game.scores.set(player.id, (game.scores.get(player.id) ?? 0) + points);
  settle(room, game, t);
}

function apply(room: Room, event: HangEvent) {
  advance(room, event.t);
  const t = room.clock;
  const player = "p" in event ? room.players.get(event.p) : undefined;
  const isHost = player !== undefined && player.id === room.host;
  const game = room.game;
  const going = game !== null && game.phase !== "final";

  switch (event.k) {
    case "create":
      return;

    case "join": {
      const name = cleanName(event.name);
      if (!name) return;
      const active = activePlayers(room).length;
      if (player) {
        if (player.kicked || player.tok !== event.tok) return;
        if (!player.active && active >= MAX_PLAYERS) return;
        player.active = true;
        player.name = name;
        player.since = t;
      } else {
        if (active >= MAX_PLAYERS) return;
        room.players.set(event.p, { id: event.p, name, tok: event.tok, seq: room.players.size, active: true, kicked: false, since: t });
      }
      // Someone arriving while you take turns still gets to pick this time round.
      if (going && game.settings.mode === "turns" && !game.order.includes(event.p)) game.order.push(event.p);
      electHost(room);
      return;
    }

    case "leave": {
      if (!player?.active) return;
      if (event.why === "kicked" && (event.by !== room.host || event.by === player.id)) return;
      player.active = false;
      if (event.why === "kicked") player.kicked = true;
      electHost(room);
      if (!going) return;
      // A picker who goes before picking leaves the first word on offer.
      if (game.phase === "choosing" && current(game).setter === player.id) choose(game, current(game), 0, t);
      settle(room, game, t);
      return;
    }

    case "settings": {
      const settings = cleanSettings(event.settings);
      if (!isHost || going || !settings) return;
      room.settings = settings;
      return;
    }

    case "start": {
      const active = activePlayers(room).length;
      if (!isHost || going || active < (room.settings.mode === "turns" ? MIN_TURNS_PLAYERS : 1)) return;
      room.games++;
      const settings = { ...room.settings, words: [...room.settings.words] };
      const fresh: Game = {
        index: room.games,
        settings,
        phase: "countdown",
        ends: t + COUNTDOWN_MS,
        rounds: [],
        words: settings.mode === "race" ? raceWords(room.salt, room.games, settings) : [],
        order: activePlayers(room).map((p) => p.id),
        position: 0,
        pass: 1,
        used: new Set(),
        scores: new Map(),
      };
      room.game = fresh;
      // Taking turns there's no countdown: the first word being picked is the wait.
      if (settings.mode === "turns") nextRound(room, fresh, t);
      return;
    }

    case "choose": {
      if (!going || game.phase !== "choosing" || game.index !== event.game || game.rounds.length - 1 !== event.round) return;
      const round = current(game);
      if (round.setter !== player?.id || !Number.isInteger(event.i) || event.i < 0 || event.i >= round.options!.length) return;
      choose(game, round, event.i, t);
      return;
    }

    case "guess": {
      if (!going || game.phase !== "playing" || game.index !== event.game || game.rounds.length - 1 !== event.round || !player?.active) return;
      if (current(game).setter === player.id) return;
      const text = cleanGuess(event.g);
      if (text) guess(room, game, player, text, t);
      return;
    }

    case "lobby": {
      if (!isHost || !game) return;
      room.game = null;
      return;
    }
  }
}

/** Replays a room's log up to `now`. Null if the log isn't a room. */
export function reduce(events: readonly HangEvent[], now: number): Room | null {
  const first = events[0];
  if (!first || first.k !== "create") return null;
  const room: Room = {
    code: first.code,
    salt: first.salt,
    settings: cleanSettings(first.settings) ?? { ...DEFAULT_SETTINGS },
    players: new Map(),
    host: null,
    game: null,
    games: 0,
    clock: first.t,
    version: 0,
  };
  for (const event of events.slice(1)) apply(room, event);
  advance(room, now);
  room.version = events.length;
  return room;
}

export const phaseOf = (room: Room): Phase => room.game?.phase ?? "lobby";

/** The word that's on, if there is one. */
export const roundOf = (room: Room): Round | null => {
  const game = room.game;
  return game && game.phase !== "countdown" && game.phase !== "final" ? current(game) : null;
};

export function gonePlayers(room: Room, seen: Readonly<Record<string, number>>, now: number): string[] {
  return [...room.players.values()]
    .filter((p) => p.active && now - Math.max(seen[p.id] ?? 0, p.since) > GONE_MS)
    .map((p) => p.id);
}

/* -------------------------------------------------------------- view */

export const PLAYER_COLORS = ["#d9480f", "#1c7ed6", "#2b8a3e", "#ae3ec9", "#f08c00", "#0c8599", "#c2255c", "#5f3dc4", "#66a80f", "#495057", "#e8590c", "#1971c2"];

export interface PlayerView {
  id: string;
  name: string;
  color: string;
  active: boolean;
  away: boolean;
  score: number;
}

/** Someone's go at the word, as everyone may see it: how far along, never which letters, until it's over. */
export interface BoardView {
  misses: number;
  shown: number;
  tries: number;
  points: number;
  /** How long they took to get it, and whether they were first, second… */
  took: number | null;
  place: number | null;
  hanged: boolean;
  /** Everything they tried, once the word's over. */
  guesses: string[] | null;
}

/** How a word went, for the end of the game. */
export interface RoundSummary {
  word: string;
  clue: string | null;
  setter: string | null;
  setterPoints: number;
  results: Record<string, { took: number | null; misses: number; hanged: boolean; points: number }>;
}

export interface GameView {
  index: number;
  mode: Mode;
  phase: GamePhase;
  ends: number;
  /** Which word this is, counting from 0. */
  round: number;
  /** How many words: known ahead in a race; taking turns, it depends who's here. */
  words: number | null;
  /** Taking turns: which time round, of how many. */
  pass: number;
  passes: number;
  time: number;
  setter: string | null;
  /** The word as nobody's found any of it: its length and its spaces. Null before it's picked. */
  pattern: string | null;
  /** The word's category, the clue; null for one of the host's own. */
  clue: string | null;
  /** How many of the word's places are letters to find. */
  letters: number;
  /** The word itself, once it's over. */
  word: string | null;
  boards: Record<string, BoardView>;
  setterPoints: number | null;
  /** Every word, with how everyone did, once the game's over. */
  history: RoundSummary[] | null;
}

export interface RoomView {
  code: string;
  version: number;
  now: number;
  host: string | null;
  /** The host's words are only counted here: they're the answers. */
  settings: { mode: Mode; rounds: number; time: number; words: number; only: boolean };
  players: PlayerView[];
  game: GameView | null;
}

function boardView(round: Round, board: Board, over: boolean): BoardView {
  const solvers = [...round.boards.values()].filter((b) => b.solved !== null).map((b) => b.solved!);
  return {
    misses: board.misses,
    shown: board.shown,
    tries: board.guesses.length,
    points: board.points,
    took: board.solved !== null ? board.solved - round.starts! : null,
    place: board.solved !== null ? solvers.filter((t) => t < board.solved!).length + 1 : null,
    hanged: board.hanged !== null,
    guesses: over ? board.guesses : null,
  };
}

function summary(round: Round): RoundSummary {
  const results: RoundSummary["results"] = {};
  for (const [id, board] of round.boards) {
    results[id] = { took: board.solved !== null ? board.solved - round.starts! : null, misses: board.misses, hanged: board.hanged !== null, points: board.points };
  }
  return { word: round.word!.text, clue: round.word!.category, setter: round.setter, setterPoints: round.setterPoints, results };
}

/**
 * What everyone in the room may see: the same for every player, so it can
 * be cached, which means it never holds the word while it's being guessed,
 * the words a picker is offered, or the host's own words.
 */
export function viewOf(room: Room, now: number, seen: Readonly<Record<string, number>> = {}): RoomView {
  const game = room.game;
  const taken = new Map<string, number>();
  const players: PlayerView[] = [];
  for (const player of [...room.players.values()].sort((a, b) => a.seq - b.seq)) {
    const key = player.name.toLocaleLowerCase("en");
    const count = (taken.get(key) ?? 0) + 1;
    taken.set(key, count);
    const score = game?.scores.get(player.id) ?? 0;
    if (!player.active && !(game && score > 0)) continue;
    players.push({
      id: player.id,
      name: count === 1 ? player.name : `${player.name} ${count}`,
      color: PLAYER_COLORS[player.seq % PLAYER_COLORS.length],
      active: player.active,
      away: player.active && now - Math.max(seen[player.id] ?? 0, player.since) > AWAY_MS,
      score,
    });
  }

  let gameView: GameView | null = null;
  if (game) {
    const round = roundOf(room);
    const word = round?.word ?? null;
    const over = game.phase === "reveal";
    const boards: Record<string, BoardView> = {};
    if (round) for (const [id, board] of round.boards) boards[id] = boardView(round, board, over);
    gameView = {
      index: game.index,
      mode: game.settings.mode,
      phase: game.phase,
      ends: game.ends,
      round: Math.max(0, game.rounds.length - 1),
      words: game.settings.mode === "race" ? game.words.length : null,
      pass: game.pass,
      passes: game.settings.rounds,
      time: game.settings.time,
      setter: round?.setter ?? null,
      pattern: word ? maskOf(word.text, new Set()) : null,
      clue: word?.category ?? null,
      letters: word ? lettersOf(word.text).length : 0,
      word: over && word ? word.text : null,
      boards,
      setterPoints: over && round?.setter ? round.setterPoints : null,
      history: game.phase === "final" ? game.rounds.filter((r) => r.word !== null && r.starts !== null).map(summary) : null,
    };
  }

  return {
    code: room.code,
    version: room.version,
    now,
    host: room.host,
    settings: { mode: room.settings.mode, rounds: room.settings.rounds, time: room.settings.time, words: room.settings.words.length, only: room.settings.only },
    players,
    game: gameView,
  };
}

/** Your go at the word that's on, which only you may see: it gives away letters. */
export interface MyRound {
  game: number;
  round: number;
  /** For whoever's picking: the three on offer, with their clues. */
  options: { text: string; clue: string | null }[] | null;
  /** The word, for whoever picked it, and for you once you've got it. */
  word: string | null;
  /** The word with what you've found; null if you picked it. */
  mask: string | null;
  guesses: string[];
  misses: number;
  solved: boolean;
  hanged: boolean;
}

export interface Mine {
  /** The host's own words, which only the host may see. */
  words: string[] | null;
  round: MyRound | null;
}

export function privateView(room: Room, player: string): Mine {
  const words = room.host === player ? room.settings.words : null;
  const game = room.game;
  const round = roundOf(room);
  if (!game || !round) return { words, round: null };
  const setter = round.setter === player;
  const board = round.boards.get(player);
  const word = round.word?.text ?? null;
  return {
    words,
    round: {
      game: game.index,
      round: game.rounds.length - 1,
      options: setter && game.phase === "choosing" ? round.options!.map((w) => ({ text: w.text, clue: w.category })) : null,
      word: word && (setter || board?.solved != null || game.phase === "reveal") ? word : null,
      mask: word && !setter ? maskOf(word, board?.found ?? new Set()) : null,
      guesses: board?.guesses ?? [],
      misses: board?.misses ?? 0,
      solved: board?.solved != null,
      hanged: board?.hanged != null,
    },
  };
}
