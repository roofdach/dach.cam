/**
 * A drawing room, as a pure function of its history, the same way geo's
 * rooms work (see lib/geo/room.ts): the server keeps an append-only log of
 * what happened, stamped with its clock, and `reduce` replays it to find out
 * whose turn it is, what the word is, who has guessed and the scores.
 *
 * A game is a few rounds; in each round everyone draws once, in the order
 * they joined. A turn is fifteen seconds for the drawer to pick one of three
 * words, then the drawing time while everyone else guesses in the chat, then
 * a few seconds showing the word. Guessing sooner scores more; the drawer
 * scores for everyone who gets it. Chat that isn't a correct guess never
 * reaches the log (it lives in its own list, see lib/draw/server/rooms.ts),
 * so the log stays small.
 */

import { cleanName } from "../rooms/codes.ts";
import { seededRandom } from "../random.ts";
import { cleanWord, letterPositions, maskWord } from "./text.ts";
import { WORDS } from "./words.ts";

export const ROUND_CHOICES = [2, 3, 4, 5] as const;
/** Seconds to draw. */
export const TIME_CHOICES = [60, 80, 100, 120] as const;

export interface Settings {
  rounds: number;
  /** Seconds to draw. */
  time: number;
  /** The host's own words. */
  words: string[];
  /** Only the host's own words, none of the built-in ones. */
  only: boolean;
}

export const DEFAULT_SETTINGS: Settings = { rounds: 3, time: 80, words: [], only: false };

export const CHOOSE_MS = 15_000;
export const REVEAL_MS = 6_000;
export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 2;
export const MAX_CUSTOM_WORDS = 200;
export const AWAY_MS = 30_000;
export const GONE_MS = 60_000;
export const MAX_EVENTS = 5000;

export type DrawEvent =
  | { k: "create"; t: number; code: string; salt: string; settings: Settings }
  | { k: "join"; t: number; p: string; name: string; tok: string }
  | { k: "leave"; t: number; p: string; why: "left" | "gone" | "kicked"; by?: string }
  | { k: "settings"; t: number; p: string; settings: Settings }
  | { k: "start"; t: number; p: string }
  | { k: "choose"; t: number; p: string; turn: number; i: number }
  | { k: "guess"; t: number; p: string; turn: number }
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

export interface Turn {
  /** Counts up across the room's whole life, so each turn's drawing has its own place. */
  id: number;
  round: number;
  drawer: string;
  options: string[];
  word: string | null;
  phase: "choosing" | "drawing" | "reveal";
  chooseBy: number;
  drawStart: number | null;
  drawEnd: number | null;
  revealEnd: number | null;
  guessed: Map<string, { t: number; points: number }>;
  drawerPoints: number;
}

export interface Game {
  index: number;
  settings: Settings;
  round: number;
  /** Who draws this round, in order, and how far along it is. */
  order: string[];
  position: number;
  turn: Turn | null;
  scores: Map<string, number>;
  used: Set<string>;
  finished: boolean;
}

/** A line the room adds to the chat by itself. */
export type Note =
  | { t: number; kind: "join" | "leave" | "kicked" | "guessed" | "drawing"; p: string }
  | { t: number; kind: "word"; word: string }
  | { t: number; kind: "round"; round: number }
  | { t: number; kind: "over" };

export interface Room {
  code: string;
  salt: string;
  settings: Settings;
  players: Map<string, Player>;
  host: string | null;
  game: Game | null;
  games: number;
  turns: number;
  notes: Note[];
  clock: number;
  version: number;
}

export type Phase = "lobby" | "choosing" | "drawing" | "reveal" | "final";

/* ----------------------------------------------------------- checking */

export function cleanSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const { rounds, time, words, only } = value as Record<string, unknown>;
  if (!(ROUND_CHOICES as readonly unknown[]).includes(rounds) || !(TIME_CHOICES as readonly unknown[]).includes(time)) return null;
  if (!Array.isArray(words) || words.length > MAX_CUSTOM_WORDS || typeof only !== "boolean") return null;
  const cleaned = [...new Set(words.map(cleanWord).filter((w): w is string => w !== null))];
  return { rounds: rounds as number, time: time as number, words: cleaned, only: only && cleaned.length >= 3 };
}

/* ------------------------------------------------------------ replay */

const activePlayers = (room: Room) => [...room.players.values()].filter((p) => p.active).sort((a, b) => a.seq - b.seq);

function electHost(room: Room) {
  room.host = activePlayers(room)[0]?.id ?? null;
}

function note(room: Room, entry: Note) {
  room.notes.push(entry);
  if (room.notes.length > 120) room.notes.splice(0, room.notes.length - 120);
}

/** The three words a turn's drawer chooses from, fixed by the room's secret salt. */
function optionsFor(room: Room, game: Game, turn: number): string[] {
  const custom = game.settings.words;
  const pool = game.settings.only ? custom : WORDS;
  const random = seededRandom(`${room.salt}:options:${turn}`);
  const picks: string[] = [];
  const pick = (list: readonly string[]) => {
    for (let tries = 0; tries < 50; tries++) {
      const word = list[Math.floor(random() * list.length)];
      if (!picks.includes(word) && (!game.used.has(word) || tries > 40)) return word;
    }
    return list.find((w) => !picks.includes(w)) ?? list[0];
  };
  for (let i = 0; i < 3; i++) {
    // With words of their own and built-in ones mixed, one of the three is always one of theirs.
    const list = !game.settings.only && custom.length > 0 && i === 0 ? custom : pool;
    picks.push(pick(list));
  }
  return picks;
}

function finish(room: Room, game: Game, at: number) {
  game.finished = true;
  game.turn = null;
  note(room, { t: at, kind: "over" });
}

/** Moves on to whoever draws next, starting new rounds as they come, from moment `at`. */
function nextTurn(room: Room, game: Game, at: number) {
  for (;;) {
    if (activePlayers(room).length < MIN_PLAYERS) return finish(room, game, at);
    while (game.position < game.order.length && !room.players.get(game.order[game.position])?.active) game.position++;
    if (game.position < game.order.length) break;
    if (game.round >= game.settings.rounds) return finish(room, game, at);
    game.round++;
    game.order = activePlayers(room).map((p) => p.id);
    game.position = 0;
    note(room, { t: at, kind: "round", round: game.round });
  }
  room.turns++;
  const drawer = game.order[game.position];
  game.turn = {
    id: room.turns,
    round: game.round,
    drawer,
    options: optionsFor(room, game, room.turns),
    word: null,
    phase: "choosing",
    chooseBy: at + CHOOSE_MS,
    drawStart: null,
    drawEnd: null,
    revealEnd: null,
    guessed: new Map(),
    drawerPoints: 0,
  };
  note(room, { t: at, kind: "drawing", p: drawer });
}

function choose(game: Game, turn: Turn, index: number, at: number) {
  turn.word = turn.options[index];
  game.used.add(turn.word);
  turn.phase = "drawing";
  turn.drawStart = at;
  turn.drawEnd = at + game.settings.time * 1000;
}

/** Stops the drawing: the drawer scores for how many of the others got it. */
function endDrawing(room: Room, game: Game, turn: Turn, at: number, drawerLeft = false) {
  const others = activePlayers(room).filter((p) => p.id !== turn.drawer);
  const eligible = new Set([...others.map((p) => p.id), ...turn.guessed.keys()]);
  turn.drawerPoints = drawerLeft || eligible.size === 0 ? 0 : Math.round((400 * turn.guessed.size) / eligible.size);
  game.scores.set(turn.drawer, (game.scores.get(turn.drawer) ?? 0) + turn.drawerPoints);
  turn.phase = "reveal";
  turn.drawEnd = Math.min(turn.drawEnd ?? at, at);
  turn.revealEnd = at + REVEAL_MS;
  note(room, { t: at, kind: "word", word: turn.word ?? "" });
}

/** Ends the drawing on the spot once everyone still here has guessed. */
function settle(room: Room, game: Game, at: number) {
  const turn = game.turn;
  if (!turn || turn.phase !== "drawing") return;
  const guessers = activePlayers(room).filter((p) => p.id !== turn.drawer);
  if (guessers.length > 0 && guessers.every((p) => turn.guessed.has(p.id))) endDrawing(room, game, turn, at);
}

/** Brings the room's timeline up to `t`: choices time out, drawings end, turns move on. */
function advance(room: Room, t: number) {
  if (t > room.clock) room.clock = t;
  const now = room.clock;
  for (;;) {
    const game = room.game;
    if (!game || game.finished || !game.turn) return;
    const turn = game.turn;
    if (turn.phase === "choosing") {
      if (now < turn.chooseBy) return;
      choose(game, turn, 0, turn.chooseBy);
    } else if (turn.phase === "drawing") {
      if (now < turn.drawEnd!) return;
      endDrawing(room, game, turn, turn.drawEnd!);
    } else {
      if (now < turn.revealEnd!) return;
      game.position++;
      nextTurn(room, game, turn.revealEnd!);
    }
  }
}

function apply(room: Room, event: DrawEvent) {
  advance(room, event.t);
  const t = room.clock;
  const player = "p" in event ? room.players.get(event.p) : undefined;
  const isHost = player !== undefined && player.id === room.host;
  const game = room.game && !room.game.finished ? room.game : null;

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
        const wasAway = !player.active;
        player.active = true;
        player.name = name;
        player.since = t;
        if (wasAway) note(room, { t, kind: "join", p: player.id });
      } else {
        if (active >= MAX_PLAYERS) return;
        room.players.set(event.p, { id: event.p, name, tok: event.tok, seq: room.players.size, active: true, kicked: false, since: t });
        note(room, { t, kind: "join", p: event.p });
      }
      // Someone arriving mid-game still gets to draw this round.
      if (game && !game.order.includes(event.p)) game.order.push(event.p);
      electHost(room);
      return;
    }

    case "leave": {
      if (!player?.active) return;
      if (event.why === "kicked" && (event.by !== room.host || event.by === player.id)) return;
      player.active = false;
      if (event.why === "kicked") player.kicked = true;
      note(room, { t, kind: event.why === "kicked" ? "kicked" : "leave", p: player.id });
      electHost(room);
      if (!game) return;
      const turn = game.turn;
      if (turn?.drawer === player.id && turn.phase === "choosing") {
        game.position++;
        nextTurn(room, game, t);
      } else if (turn?.drawer === player.id && turn.phase === "drawing") {
        endDrawing(room, game, turn, t, true);
      } else if (activePlayers(room).length < MIN_PLAYERS) {
        if (turn?.phase === "drawing") endDrawing(room, game, turn, t);
        finish(room, game, t);
      } else {
        settle(room, game, t);
      }
      return;
    }

    case "settings": {
      const settings = cleanSettings(event.settings);
      if (!isHost || game || !settings) return;
      room.settings = settings;
      return;
    }

    case "start": {
      if (!isHost || game || activePlayers(room).length < MIN_PLAYERS) return;
      room.games++;
      const fresh: Game = {
        index: room.games,
        settings: { ...room.settings, words: [...room.settings.words] },
        round: 1,
        order: activePlayers(room).map((p) => p.id),
        position: 0,
        turn: null,
        scores: new Map(),
        used: new Set(),
        finished: false,
      };
      room.game = fresh;
      note(room, { t, kind: "round", round: 1 });
      nextTurn(room, fresh, t);
      return;
    }

    case "choose": {
      const turn = game?.turn;
      if (!game || !turn || turn.id !== event.turn || turn.phase !== "choosing" || turn.drawer !== player?.id) return;
      if (!Number.isInteger(event.i) || event.i < 0 || event.i >= turn.options.length) return;
      choose(game, turn, event.i, t);
      return;
    }

    case "guess": {
      const turn = game?.turn;
      if (!game || !turn || turn.id !== event.turn || turn.phase !== "drawing" || !player?.active) return;
      if (player.id === turn.drawer || turn.guessed.has(player.id) || t >= turn.drawEnd!) return;
      const left = (turn.drawEnd! - t) / (game.settings.time * 1000);
      const points = Math.round(50 + 450 * Math.max(0, Math.min(1, left)));
      turn.guessed.set(player.id, { t, points });
      game.scores.set(player.id, (game.scores.get(player.id) ?? 0) + points);
      note(room, { t, kind: "guessed", p: player.id });
      settle(room, game, t);
      return;
    }

    case "lobby": {
      if (!isHost || !room.game) return;
      room.game = null;
      return;
    }
  }
}

/** Replays a room's log up to `now`. Null if the log isn't a room. */
export function reduce(events: readonly DrawEvent[], now: number): Room | null {
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
    turns: 0,
    notes: [],
    clock: first.t,
    version: 0,
  };
  for (const event of events.slice(1)) apply(room, event);
  advance(room, now);
  room.version = events.length;
  return room;
}

export function phaseOf(room: Room): Phase {
  const game = room.game;
  if (!game) return "lobby";
  if (game.finished || !game.turn) return "final";
  return game.turn.phase;
}

export function gonePlayers(room: Room, seen: Readonly<Record<string, number>>, now: number): string[] {
  return [...room.players.values()]
    .filter((p) => p.active && now - Math.max(seen[p.id] ?? 0, p.since) > GONE_MS)
    .map((p) => p.id);
}

/** Which letters a turn's hints have uncovered by now: one at half time, another at three quarters. */
export function hintPositions(room: Room, turn: Turn, now: number): Set<number> {
  if (!turn.word || turn.drawStart === null || turn.drawEnd === null) return new Set();
  const letters = letterPositions(turn.word);
  const share = (now - turn.drawStart) / (room.game!.settings.time * 1000);
  const count = Math.min(Math.floor(letters.length / 3), share >= 0.75 ? 2 : share >= 0.5 ? 1 : 0);
  const random = seededRandom(`${room.salt}:hints:${turn.id}`);
  const shuffled = [...letters];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return new Set(shuffled.slice(0, count));
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

export interface TurnView {
  id: number;
  round: number;
  drawer: string;
  phase: "choosing" | "drawing" | "reveal";
  /** When this phase ends, by the server's clock. */
  ends: number;
  /** The word with its hidden letters as "_", while it's being drawn. */
  mask: string | null;
  /** The word itself, once the turn is over. */
  word: string | null;
  guessed: string[];
  /** What everyone scored this turn, once it's over. */
  gained: Record<string, number> | null;
}

/** A note as the room shows it, with the name of whoever it's about, even if they've gone. */
export type NoteView = Note & { name?: string };

export interface RoomView {
  code: string;
  version: number;
  now: number;
  host: string | null;
  settings: { rounds: number; time: number; words: number; only: boolean };
  players: PlayerView[];
  notes: NoteView[];
  game: { index: number; round: number; rounds: number; phase: Exclude<Phase, "lobby">; turn: TurnView | null } | null;
}

/**
 * What everyone in the room may see: the same for every player, so it can be
 * cached, which means it never holds the word while it's being guessed, or
 * the host's own words. The drawer, and whoever has guessed, get the word
 * separately (see `privateView`).
 */
export function viewOf(room: Room, now: number, seen: Readonly<Record<string, number>> = {}): RoomView {
  const game = room.game;
  // Two people with one name become "Sam" and "Sam 2", counting everyone who's been here so notes stay right.
  const taken = new Map<string, number>();
  const names = new Map<string, string>();
  for (const player of [...room.players.values()].sort((a, b) => a.seq - b.seq)) {
    const key = player.name.toLocaleLowerCase("en");
    const count = (taken.get(key) ?? 0) + 1;
    taken.set(key, count);
    names.set(player.id, count === 1 ? player.name : `${player.name} ${count}`);
  }
  const players: PlayerView[] = [];
  for (const player of [...room.players.values()].sort((a, b) => a.seq - b.seq)) {
    const score = game?.scores.get(player.id) ?? 0;
    if (!player.active && !(game && score > 0)) continue;
    players.push({
      id: player.id,
      name: names.get(player.id)!,
      color: PLAYER_COLORS[player.seq % PLAYER_COLORS.length],
      active: player.active,
      away: player.active && now - Math.max(seen[player.id] ?? 0, player.since) > AWAY_MS,
      score,
    });
  }

  let gameView: RoomView["game"] = null;
  if (game) {
    const turn = game.finished ? null : game.turn;
    let turnView: TurnView | null = null;
    if (turn) {
      const reveal = turn.phase === "reveal";
      const gained: Record<string, number> = {};
      if (reveal) {
        for (const [id, g] of turn.guessed) gained[id] = g.points;
        gained[turn.drawer] = turn.drawerPoints;
      }
      turnView = {
        id: turn.id,
        round: turn.round,
        drawer: turn.drawer,
        phase: turn.phase,
        ends: turn.phase === "choosing" ? turn.chooseBy : turn.phase === "drawing" ? turn.drawEnd! : turn.revealEnd!,
        mask: turn.phase === "drawing" && turn.word ? maskWord(turn.word, hintPositions(room, turn, now)) : null,
        word: reveal ? turn.word : null,
        guessed: [...turn.guessed.keys()],
        gained: reveal ? gained : null,
      };
    }
    gameView = { index: game.index, round: game.round, rounds: game.settings.rounds, phase: phaseOf(room) as Exclude<Phase, "lobby">, turn: turnView };
  }

  return {
    code: room.code,
    version: room.version,
    now,
    host: room.host,
    settings: { rounds: room.settings.rounds, time: room.settings.time, words: room.settings.words.length, only: room.settings.only },
    players,
    notes: room.notes.slice(-60).map((note) => ("p" in note ? { ...note, name: names.get(note.p) ?? "someone" } : note)),
    game: gameView,
  };
}

/** What only one player may see: the words on offer and the word, if they're drawing or have guessed it; the host's own words. */
export function privateView(room: Room, player: string): { options: string[] | null; word: string | null; words: string[] | null } {
  const turn = room.game && !room.game.finished ? room.game.turn : null;
  const drawing = turn?.drawer === player;
  return {
    options: drawing && turn?.phase === "choosing" ? turn.options : null,
    word: turn?.word && (drawing || turn.guessed.has(player)) ? turn.word : null,
    words: room.host === player ? room.settings.words : null,
  };
}
