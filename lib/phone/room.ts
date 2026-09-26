/**
 * Telephone with pictures, the way Gartic Phone plays it. Everyone writes
 * something odd. Then each piece of writing moves on to the next player, who
 * draws it; each drawing moves on again, and the next player writes what
 * they think it shows; and so on, drawing and describing in turn, until each
 * chain has been through everyone once. Then the chains are shown, a step at
 * a time, to everyone together, the host clicking through.
 *
 * As with the other rooms (see lib/draw/room.ts), the server keeps a log of
 * what happened and this replays it. The log only says that someone handed
 * something in; what they wrote or drew sits beside it, in a list per chain
 * (see lib/phone/server/rooms.ts), so the log stays small.
 */

import { cleanName } from "../rooms/codes.ts";
import { compact, isOp, type Op } from "../draw/ink.ts";

/** Seconds for each kind of step. */
export const SPEEDS = {
  quick: { write: 30, draw: 60, describe: 25 },
  normal: { write: 45, draw: 90, describe: 40 },
  slow: { write: 60, draw: 150, describe: 60 },
} as const;
export type Speed = keyof typeof SPEEDS;
export const SPEED_NAMES: readonly Speed[] = ["quick", "normal", "slow"];

export interface Settings {
  speed: Speed;
}

export const DEFAULT_SETTINGS: Settings = { speed: "normal" };

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
/** Work that arrives this soon after time's up still counts: it was sent as the clock ran out. */
export const GRACE_MS = 3000;
export const AWAY_MS = 30_000;
export const GONE_MS = 60_000;
export const MAX_EVENTS = 3000;
/** The longest thing anyone can write. */
export const MAX_TEXT = 100;
/** How much one drawing may be. */
export const MAX_DRAWING_OPS = 4000;
export const MAX_DRAWING_POINTS = 40_000;
export const MAX_DRAWING_BYTES = 200_000;

/** What a step asks of you: start a chain, draw what you read, or say what you see. */
export type Kind = "write" | "draw" | "describe";
/** What you hand in. */
export type Work = "text" | "drawing";

export type PhoneEvent =
  | { k: "create"; t: number; code: string; settings: Settings }
  | { k: "join"; t: number; p: string; name: string; tok: string }
  | { k: "leave"; t: number; p: string; why: "left" | "gone" | "kicked"; by?: string }
  | { k: "settings"; t: number; p: string; settings: Settings }
  | { k: "start"; t: number; p: string }
  | { k: "submit"; t: number; p: string; game: number; step: number; work: Work }
  | { k: "show"; t: number; p: string; game: number; n: number }
  | { k: "lobby"; t: number; p: string };

/** One step of a chain, as kept beside the log. */
export type Entry = { step: number; p: string; text: string } | { step: number; p: string; ops: Op[] };

export interface Player {
  id: string;
  name: string;
  tok: string;
  seq: number;
  active: boolean;
  kicked: boolean;
  since: number;
}

export interface Game {
  index: number;
  settings: Settings;
  /** Everyone playing, in their seats. Chain `i` starts with `order[i]`, and at step `s` is with `order[(i + s) % n]`. */
  order: string[];
  /** The step being played, or `order.length` once they're all done. */
  step: number;
  stepEnd: number;
  /** What each player handed in at each step. */
  handed: Map<string, Work>[];
  /** How many of the finished chains' steps are showing. */
  shown: number;
}

export interface Room {
  code: string;
  settings: Settings;
  players: Map<string, Player>;
  host: string | null;
  game: Game | null;
  games: number;
  clock: number;
  version: number;
}

export type Phase = "lobby" | "playing" | "reveal";

/* ----------------------------------------------------------- checking */

export function cleanSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const { speed } = value as Record<string, unknown>;
  return (SPEED_NAMES as readonly unknown[]).includes(speed) ? { speed: speed as Speed } : null;
}

/** Tidies what someone wrote: single spaces, no control characters, not too long. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/g, " ").trim();
  const short = Array.from(text).slice(0, MAX_TEXT).join("").trim();
  return short.length > 0 ? short : null;
}

/** A drawing fit to keep: well-formed operations, and not too many of them. */
export function isDrawing(value: unknown): value is Op[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DRAWING_OPS) return false;
  let points = 0;
  for (const op of value) {
    if (!isOp(op)) return false;
    if (op[0] === "l") points += (op.length - 4) / 2;
  }
  return points <= MAX_DRAWING_POINTS;
}

const sizeOf = (ops: readonly Op[]) => JSON.stringify(ops).length + 64;
const pointsOf = (ops: readonly Op[]) => ops.reduce((n, op) => n + (op[0] === "l" ? (op.length - 4) / 2 : 0), 0);

/** Every other point of every line, keeping each line's ends. */
function thin(ops: readonly Op[]): Op[] {
  return ops.map((op) => {
    if (op[0] !== "l" || op.length <= 8) return op;
    const n = (op.length - 4) / 2;
    const kept: number[] = [];
    for (let i = 0; i < n; i += 2) kept.push(op[4 + 2 * i] as number, op[5 + 2 * i] as number);
    if ((n - 1) % 2 !== 0) kept.push(op[op.length - 2] as number, op[op.length - 1] as number);
    return ["l", op[1], op[2], op[3], ...kept] as Op;
  });
}

/**
 * A drawing ready to hand in: only what's showing, and if that's still too
 * much to send, its lines thinned out until it fits, which a busy drawing
 * barely shows. Null if there's nothing to hand in.
 */
export function fitDrawing(ops: readonly Op[]): Op[] | null {
  let out = compact(ops);
  if (out.length === 0 || out.length > MAX_DRAWING_OPS) return out.length === 0 ? null : out.slice(-MAX_DRAWING_OPS);
  for (let i = 0; i < 8 && (sizeOf(out) > MAX_DRAWING_BYTES || pointsOf(out) > MAX_DRAWING_POINTS); i++) out = thin(out);
  return sizeOf(out) > MAX_DRAWING_BYTES ? null : out;
}

/* ------------------------------------------------------------- chains */

/** What a step usually asks: the first writes, then drawing and describing take turns. */
export function stepKind(step: number): Kind {
  return step === 0 ? "write" : step % 2 === 1 ? "draw" : "describe";
}

export function stepMs(settings: Settings, step: number): number {
  return SPEEDS[settings.speed][stepKind(step)] * 1000;
}

/** Who has chain `chain` at step `step`. */
export function holder(game: Game, chain: number, step: number): string {
  return game.order[(chain + step) % game.order.length];
}

/** Which chain a player has at a step, or -1 if they're not playing. */
export function chainOf(game: Game, player: string, step: number): number {
  const seat = game.order.indexOf(player);
  if (seat < 0) return -1;
  const n = game.order.length;
  return (((seat - step) % n) + n) % n;
}

/** The latest step of a chain before `before` that someone handed something in for. */
export function lastWork(game: Game, chain: number, before: number): { step: number; work: Work } | null {
  for (let step = before - 1; step >= 0; step--) {
    const work = game.handed[step]?.get(holder(game, chain, step));
    if (work) return { step, work };
  }
  return null;
}

export interface Task {
  chain: number;
  kind: Kind;
  /** The step whose work this one follows on from; null when starting the chain. */
  from: number | null;
}

/**
 * What a player is to do this step. It follows from what the chain last got,
 * not only from the step's number, so a chain that someone skipped carries
 * on sensibly: a drawing that never came means the next person draws the
 * writing instead.
 */
export function taskOf(game: Game, player: string): Task | null {
  if (game.step >= game.order.length) return null;
  const chain = chainOf(game, player, game.step);
  if (chain < 0) return null;
  const last = lastWork(game, chain, game.step);
  if (!last) return { chain, kind: "write", from: null };
  return { chain, kind: last.work === "text" ? "draw" : "describe", from: last.step };
}

export const workFor = (kind: Kind): Work => (kind === "draw" ? "drawing" : "text");

export interface ChainView {
  owner: string;
  entries: { step: number; p: string; work: Work }[];
}

/** Every chain, with the steps that have something in them. */
export function albumOf(game: Game): ChainView[] {
  return game.order.map((owner, chain) => {
    const entries: ChainView["entries"] = [];
    for (let step = 0; step < game.order.length; step++) {
      const p = holder(game, chain, step);
      const work = game.handed[step]?.get(p);
      if (work) entries.push({ step, p, work });
    }
    return { owner, entries };
  });
}

const totalEntries = (game: Game) => albumOf(game).reduce((sum, chain) => sum + chain.entries.length, 0);

/* ------------------------------------------------------------ replay */

const activePlayers = (room: Room) => [...room.players.values()].filter((p) => p.active).sort((a, b) => a.seq - b.seq);

function electHost(room: Room) {
  room.host = activePlayers(room)[0]?.id ?? null;
}

function nextStep(room: Room, game: Game, at: number) {
  game.step++;
  if (game.step >= game.order.length) {
    // All done: the reveal starts with the first thing anyone wrote.
    game.shown = Math.min(1, totalEntries(game));
    return;
  }
  game.stepEnd = at + stepMs(game.settings, game.step);
  game.handed[game.step] = new Map();
  settle(room, game, at);
}

/** Moves on as soon as everyone still here has handed in. */
function settle(room: Room, game: Game, at: number) {
  if (game.step >= game.order.length) return;
  const handed = game.handed[game.step];
  const waiting = game.order.some((id) => room.players.get(id)?.active && !handed.has(id));
  if (!waiting) nextStep(room, game, at);
}

/** Brings the room's timeline up to `t`: steps run out of time and move on. */
function advance(room: Room, t: number) {
  if (t > room.clock) room.clock = t;
  for (;;) {
    const game = room.game;
    if (!game || game.step >= game.order.length) return;
    const end = game.stepEnd + GRACE_MS;
    if (room.clock < end) return;
    nextStep(room, game, end);
  }
}

function apply(room: Room, event: PhoneEvent) {
  advance(room, event.t);
  const t = room.clock;
  const player = "p" in event ? room.players.get(event.p) : undefined;
  const isHost = player !== undefined && player.id === room.host;
  const game = room.game;
  const playing = game !== null && game.step < game.order.length;

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
      // Nobody waits for someone who's gone.
      if (game && playing) settle(room, game, t);
      return;
    }

    case "settings": {
      const settings = cleanSettings(event.settings);
      if (!isHost || playing || !settings) return;
      room.settings = settings;
      return;
    }

    case "start": {
      if (!isHost || playing) return;
      const order = activePlayers(room).map((p) => p.id);
      if (order.length < MIN_PLAYERS) return;
      room.games++;
      room.game = {
        index: room.games,
        settings: { ...room.settings },
        order,
        step: 0,
        stepEnd: t + stepMs(room.settings, 0),
        handed: [new Map()],
        shown: 0,
      };
      return;
    }

    case "submit": {
      if (!game || !playing || game.index !== event.game || game.step !== event.step || !player?.active) return;
      const task = taskOf(game, player.id);
      const handed = game.handed[game.step];
      if (!task || handed.has(player.id) || workFor(task.kind) !== event.work) return;
      handed.set(player.id, event.work);
      settle(room, game, t);
      return;
    }

    case "show": {
      if (!isHost || !game || playing || game.index !== event.game) return;
      if (event.n === game.shown + 1 && event.n <= totalEntries(game)) game.shown = event.n;
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
export function reduce(events: readonly PhoneEvent[], now: number): Room | null {
  const first = events[0];
  if (!first || first.k !== "create") return null;
  const room: Room = {
    code: first.code,
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

export function phaseOf(room: Room): Phase {
  const game = room.game;
  if (!game) return "lobby";
  return game.step < game.order.length ? "playing" : "reveal";
}

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
}

export interface GameView {
  index: number;
  phase: "playing" | "reveal";
  order: string[];
  step: number;
  steps: number;
  /** What this step usually asks. */
  kind: Kind;
  /** When this step's time is up, by the server's clock. */
  ends: number;
  /** Who has handed in this step. */
  handed: string[];
  /** Once it's over: who wrote and drew what, in each chain. */
  album: ChainView[] | null;
  /** How many of the album's steps are showing. */
  shown: number;
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
  // Two people with one name become "Sam" and "Sam 2".
  const taken = new Map<string, number>();
  const players: PlayerView[] = [];
  for (const player of [...room.players.values()].sort((a, b) => a.seq - b.seq)) {
    const key = player.name.toLocaleLowerCase("en");
    const count = (taken.get(key) ?? 0) + 1;
    taken.set(key, count);
    // Someone who left mid-game stays listed, since their work is in the chains.
    if (!player.active && !game?.order.includes(player.id)) continue;
    players.push({
      id: player.id,
      name: count === 1 ? player.name : `${player.name} ${count}`,
      color: PLAYER_COLORS[player.seq % PLAYER_COLORS.length],
      active: player.active,
      away: player.active && now - Math.max(seen[player.id] ?? 0, player.since) > AWAY_MS,
    });
  }
  let gameView: GameView | null = null;
  if (game) {
    const playing = game.step < game.order.length;
    gameView = {
      index: game.index,
      phase: playing ? "playing" : "reveal",
      order: game.order,
      step: Math.min(game.step, game.order.length - 1),
      steps: game.order.length,
      kind: stepKind(Math.min(game.step, game.order.length - 1)),
      ends: game.stepEnd,
      handed: playing ? [...game.handed[game.step].keys()] : [],
      album: playing ? null : albumOf(game),
      shown: game.shown,
    };
  }
  return { code: room.code, version: room.version, now, host: room.host, settings: room.settings, players, game: gameView };
}
