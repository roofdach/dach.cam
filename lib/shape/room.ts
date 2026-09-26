/**
 * A shape race: everyone in the room gets the same outline at the same
 * moment and types guesses. Wrong ones tell only you how far off you are and
 * which way; the sooner you name it, the more you score. A round ends when
 * everyone still here has it (or is out of guesses), or when time's up.
 *
 * As with the other rooms (see lib/draw/room.ts), the server keeps a log of
 * what happened and this replays it. The countries come from the room's
 * secret salt, so nobody can see what's coming, and nobody's view says what
 * the answer is until the round's over.
 */

import { cleanName } from "../rooms/codes.ts";
import { BY_CODE, MAX_GUESSES, hintFor, pickTargets, type Hint } from "./game.ts";

export const ROUND_CHOICES = [5, 10, 15] as const;
/** Seconds per outline. */
export const TIME_CHOICES = [20, 30, 45] as const;

export interface Settings {
  rounds: number;
  time: number;
}

export const DEFAULT_SETTINGS: Settings = { rounds: 10, time: 30 };
export const COUNTDOWN_MS = 3000;
export const REVEAL_MS = 5000;
export const MAX_PLAYERS = 30;
export const AWAY_MS = 30_000;
export const GONE_MS = 60_000;
export const MAX_EVENTS = 6000;

export type ShapeEvent =
  | { k: "create"; t: number; code: string; salt: string; settings: Settings }
  | { k: "join"; t: number; p: string; name: string; tok: string }
  | { k: "leave"; t: number; p: string; why: "left" | "gone" | "kicked"; by?: string }
  | { k: "settings"; t: number; p: string; settings: Settings }
  | { k: "start"; t: number; p: string }
  | { k: "guess"; t: number; p: string; game: number; round: number; c: string }
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

export type Phase = "lobby" | "countdown" | "playing" | "reveal" | "final";

export interface Game {
  index: number;
  settings: Settings;
  targets: string[];
  round: number;
  phase: Exclude<Phase, "lobby">;
  /** When the phase that's on ends. */
  ends: number;
  /** Each round's guesses, by player, in order. */
  guesses: Map<string, string[]>[];
  /** Each round's winners, by player: when, and for how much. */
  solved: Map<string, { t: number; points: number }>[];
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

export function cleanSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const { rounds, time } = value as Record<string, unknown>;
  if (!(ROUND_CHOICES as readonly unknown[]).includes(rounds) || !(TIME_CHOICES as readonly unknown[]).includes(time)) return null;
  return { rounds: rounds as number, time: time as number };
}

/** Points for naming it: more the sooner, less for each wrong go first. */
export function pointsFor(left: number, wrong: number): number {
  return Math.max(100, Math.round(200 + 800 * Math.max(0, Math.min(1, left))) - 50 * wrong);
}

/* ------------------------------------------------------------ replay */

const activePlayers = (room: Room) => [...room.players.values()].filter((p) => p.active).sort((a, b) => a.seq - b.seq);

function electHost(room: Room) {
  room.host = activePlayers(room)[0]?.id ?? null;
}

function startRound(game: Game, at: number) {
  game.phase = "playing";
  game.ends = at + game.settings.time * 1000;
  game.guesses[game.round] = new Map();
  game.solved[game.round] = new Map();
}

function endRound(game: Game, at: number) {
  game.phase = "reveal";
  game.ends = at + REVEAL_MS;
}

/** Ends the round early once nobody still here is still trying. */
function settle(room: Room, game: Game, at: number) {
  if (game.phase !== "playing") return;
  const guesses = game.guesses[game.round];
  const solved = game.solved[game.round];
  const trying = activePlayers(room).some((p) => !solved.has(p.id) && (guesses.get(p.id)?.length ?? 0) < MAX_GUESSES);
  if (!trying) endRound(game, at);
}

/** Brings the room's timeline up to `t`: the countdown runs out, rounds end, the next begins. */
function advance(room: Room, t: number) {
  if (t > room.clock) room.clock = t;
  for (;;) {
    const game = room.game;
    if (!game || game.phase === "final" || room.clock < game.ends) return;
    if (game.phase === "countdown") startRound(game, game.ends);
    else if (game.phase === "playing") endRound(game, game.ends);
    else if (game.round + 1 < game.targets.length) {
      game.round++;
      startRound(game, game.ends);
    } else {
      game.phase = "final";
    }
  }
}

function apply(room: Room, event: ShapeEvent) {
  advance(room, event.t);
  const t = room.clock;
  const player = "p" in event ? room.players.get(event.p) : undefined;
  const isHost = player !== undefined && player.id === room.host;
  const game = room.game;
  const racing = game !== null && game.phase !== "final";

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
      electHost(room);
      return;
    }

    case "leave": {
      if (!player?.active) return;
      if (event.why === "kicked" && (event.by !== room.host || event.by === player.id)) return;
      player.active = false;
      if (event.why === "kicked") player.kicked = true;
      electHost(room);
      if (game) settle(room, game, t);
      return;
    }

    case "settings": {
      const settings = cleanSettings(event.settings);
      if (!isHost || racing || !settings) return;
      room.settings = settings;
      return;
    }

    case "start": {
      if (!isHost || racing || activePlayers(room).length === 0) return;
      room.games++;
      room.game = {
        index: room.games,
        settings: { ...room.settings },
        targets: pickTargets(`${room.salt}:${room.games}`, room.settings.rounds).map((c) => c.code),
        round: 0,
        phase: "countdown",
        ends: t + COUNTDOWN_MS,
        guesses: [],
        solved: [],
        scores: new Map(),
      };
      return;
    }

    case "guess": {
      if (!game || game.phase !== "playing" || game.index !== event.game || game.round !== event.round || !player?.active) return;
      if (!BY_CODE.has(event.c)) return;
      const guesses = game.guesses[game.round];
      const solved = game.solved[game.round];
      const mine = guesses.get(player.id) ?? [];
      if (solved.has(player.id) || mine.length >= MAX_GUESSES || mine.includes(event.c)) return;
      guesses.set(player.id, [...mine, event.c]);
      if (event.c === game.targets[game.round]) {
        const points = pointsFor((game.ends - t) / (game.settings.time * 1000), mine.length);
        solved.set(player.id, { t, points });
        game.scores.set(player.id, (game.scores.get(player.id) ?? 0) + points);
      }
      settle(room, game, t);
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
export function reduce(events: readonly ShapeEvent[], now: number): Room | null {
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

export interface GameView {
  index: number;
  round: number;
  rounds: number;
  time: number;
  phase: Exclude<Phase, "lobby">;
  ends: number;
  /** The outline being guessed, and once it's over, the one just gone. Never which country it is, until then. */
  shape: { path: string; w: number; h: number } | null;
  answer: string | null;
  /** This round: who has it and for how much, and how many goes everyone's had. */
  solved: { p: string; points: number }[];
  tries: Record<string, number>;
  /** The countries so far, for the final scores. */
  past: string[];
}

export interface RoomView {
  code: string;
  version: number;
  now: number;
  host: string | null;
  settings: Settings;
  players: PlayerView[];
  game: GameView | null;
}

/** What everyone in the room may see: the same for every player, so it can be cached. */
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
    const showing = game.phase === "playing" || game.phase === "reveal";
    const target = showing ? BY_CODE.get(game.targets[game.round])! : null;
    const over = game.phase === "reveal" || game.phase === "final";
    const played = game.phase === "final" ? game.targets.length : game.phase === "reveal" ? game.round + 1 : game.round;
    gameView = {
      index: game.index,
      round: game.round,
      rounds: game.targets.length,
      time: game.settings.time,
      phase: game.phase,
      ends: game.ends,
      shape: target ? { path: target.path, w: target.w, h: target.h } : null,
      answer: over && game.phase !== "final" ? game.targets[game.round] : null,
      solved: showing ? [...game.solved[game.round]].map(([p, s]) => ({ p, points: s.points })) : [],
      tries: showing ? Object.fromEntries([...game.guesses[game.round]].map(([p, g]) => [p, g.length])) : {},
      past: game.targets.slice(0, played),
    };
  }
  return { code: room.code, version: room.version, now, host: room.host, settings: room.settings, players, game: gameView };
}

/** Your goes this round, with how far off each was: only for you, since they give away where the answer is. */
export function privateView(room: Room, player: string): { game: number; round: number; hints: Hint[]; solved: boolean } | null {
  const game = room.game;
  if (!game || (game.phase !== "playing" && game.phase !== "reveal")) return null;
  const target = BY_CODE.get(game.targets[game.round])!;
  const guesses = game.guesses[game.round]?.get(player) ?? [];
  return { game: game.index, round: game.round, hints: guesses.map((c) => hintFor(BY_CODE.get(c)!, target)), solved: game.solved[game.round]?.has(player) ?? false };
}
