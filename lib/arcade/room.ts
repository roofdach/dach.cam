/**
 * A versus room for the arcade games: two of you (or up to eight), the same
 * course or board for everyone, all at once. Each round, everyone plays
 * until they're out, watching the others as they go; the best score takes
 * the round (the longest run, if that's level), and the first to win so
 * many rounds takes the match.
 *
 * As with the other rooms (see lib/draw/room.ts), the server keeps a log of
 * what happened and this replays it. A finished run is played back by the
 * server before it goes in the log (see lib/arcade/games.ts), so a score
 * here is one somebody really got. Seeds come from the room's secret salt.
 */

import { seededRandom } from "../random.ts";
import { cleanName } from "../rooms/codes.ts";
import type { ArcadeGame } from "./games.ts";

/** Rounds to win the match. */
export const TO_CHOICES = [1, 3, 5] as const;

export interface Settings {
  to: number;
}

export const DEFAULT_SETTINGS: Settings = { to: 3 };
export const COUNTDOWN_MS = 3500;
/** How long a round can go on: past it, whoever's still going stops where they are. */
export const ROUND_MS: Record<ArcadeGame, number> = { flap: 4 * 60_000, snake: 5 * 60_000 };
/** After the clock, for runs still on their way in. */
export const GRACE_MS = 15_000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const AWAY_MS = 30_000;
export const GONE_MS = 60_000;
export const MAX_EVENTS = 6000;

export type VersusEvent =
  | { k: "create"; t: number; code: string; salt: string; game: ArcadeGame; settings: Settings }
  | { k: "join"; t: number; p: string; name: string; tok: string }
  | { k: "leave"; t: number; p: string; why: "left" | "gone" | "kicked"; by?: string }
  | { k: "settings"; t: number; p: string; settings: Settings }
  /** The next round, or a new match once one's won. */
  | { k: "start"; t: number; p: string }
  /** A run, already played back by the server. */
  | { k: "finish"; t: number; p: string; match: number; round: number; score: number; length: number };

export interface Player {
  id: string;
  name: string;
  tok: string;
  seq: number;
  active: boolean;
  kicked: boolean;
  since: number;
}

export interface Result {
  score: number;
  length: number;
  t: number;
}

export interface Round {
  index: number;
  seed: string;
  /** When everyone goes. */
  startAt: number;
  /** When it's over whatever happens. */
  endsBy: number;
  /** Who's in it: whoever was here when it started. */
  players: string[];
  results: Map<string, Result>;
  done: boolean;
  /** Null for a draw. */
  winner: string | null;
}

export interface Match {
  index: number;
  to: number;
  wins: Map<string, number>;
  round: Round;
  rounds: number;
  /** Once somebody's won enough rounds. */
  winner: string | null;
}

export interface Room {
  code: string;
  salt: string;
  game: ArcadeGame;
  settings: Settings;
  players: Map<string, Player>;
  host: string | null;
  match: Match | null;
  matches: number;
  clock: number;
  version: number;
}

export type Phase = "lobby" | "countdown" | "playing" | "results" | "over";

export function cleanSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const { to } = value as Record<string, unknown>;
  return (TO_CHOICES as readonly unknown[]).includes(to) ? { to: to as number } : null;
}

/** A round's seed, from the salt: the same for everyone in it, and nobody can tell the next from it. */
export function seedFor(salt: string, match: number, round: number): string {
  const random = seededRandom(`${salt}:seed:${match}:${round}`);
  let seed = "";
  for (let i = 0; i < 12; i++) seed += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)];
  return seed;
}

/* ------------------------------------------------------------ replay */

const activePlayers = (room: Room) => [...room.players.values()].filter((p) => p.active).sort((a, b) => a.seq - b.seq);

function electHost(room: Room) {
  room.host = activePlayers(room)[0]?.id ?? null;
}

/** The round's over once everyone in it who's still here has finished, or time's up. */
function settle(room: Room, at: number) {
  const round = room.match?.round;
  if (!round || round.done) return;
  const waiting = round.players.some((id) => room.players.get(id)?.active && !round.results.has(id));
  if (waiting && at < round.endsBy) return;
  round.done = true;
  let best: [string, Result] | null = null;
  let level = false;
  for (const entry of round.results) {
    const [, r] = entry;
    const top = best?.[1];
    if (!top || r.score > top.score || (r.score === top.score && r.length > top.length)) [best, level] = [entry, false];
    else if (r.score === top.score && r.length === top.length) level = true;
  }
  round.winner = best && !level ? best[0] : null;
  const match = room.match!;
  if (round.winner) {
    const wins = (match.wins.get(round.winner) ?? 0) + 1;
    match.wins.set(round.winner, wins);
    if (wins >= match.to) match.winner = round.winner;
  }
}

function startRound(room: Room, at: number, fresh: boolean) {
  if (fresh || !room.match) {
    room.matches++;
    room.match = { index: room.matches, to: room.settings.to, wins: new Map(), round: null!, rounds: 0, winner: null };
  }
  const match = room.match;
  match.rounds++;
  const startAt = at + COUNTDOWN_MS;
  match.round = {
    index: match.rounds,
    seed: seedFor(room.salt, match.index, match.rounds),
    startAt,
    endsBy: startAt + ROUND_MS[room.game] + GRACE_MS,
    players: activePlayers(room).map((p) => p.id),
    results: new Map(),
    done: false,
    winner: null,
  };
}

function apply(room: Room, event: VersusEvent) {
  if (event.t > room.clock) room.clock = event.t;
  const t = room.clock;
  settle(room, t);
  const player = "p" in event ? room.players.get(event.p) : undefined;
  const isHost = player !== undefined && player.id === room.host;
  const phase = phaseOf(room, t);

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
      settle(room, t);
      return;
    }

    case "settings": {
      const settings = cleanSettings(event.settings);
      if (!isHost || !settings || (phase !== "lobby" && phase !== "over")) return;
      room.settings = settings;
      return;
    }

    case "start": {
      if (!isHost || activePlayers(room).length < MIN_PLAYERS) return;
      if (phase === "countdown" || phase === "playing") return;
      startRound(room, t, phase !== "results");
      return;
    }

    case "finish": {
      const match = room.match;
      const round = match?.round;
      if (!player?.active || !round || match.index !== event.match || round.index !== event.round || round.done || t < round.startAt) return;
      if (!round.players.includes(player.id) || round.results.has(player.id)) return;
      if (!Number.isInteger(event.score) || !Number.isInteger(event.length)) return;
      round.results.set(player.id, { score: event.score, length: event.length, t });
      settle(room, t);
      return;
    }
  }
}

/** Replays a room's log up to `now`. Null if the log isn't a room. */
export function reduce(events: readonly VersusEvent[], now: number): Room | null {
  const first = events[0];
  if (!first || first.k !== "create") return null;
  const room: Room = {
    code: first.code,
    salt: first.salt,
    game: first.game,
    settings: cleanSettings(first.settings) ?? { ...DEFAULT_SETTINGS },
    players: new Map(),
    host: null,
    match: null,
    matches: 0,
    clock: first.t,
    version: 0,
  };
  for (const event of events.slice(1)) apply(room, event);
  if (now > room.clock) room.clock = now;
  settle(room, room.clock);
  room.version = events.length;
  return room;
}

export function phaseOf(room: Room, now = room.clock): Phase {
  const match = room.match;
  if (!match) return "lobby";
  const round = match.round;
  if (round.done) return match.winner ? "over" : "results";
  return now < round.startAt ? "countdown" : "playing";
}

export function gonePlayers(room: Room, seen: Readonly<Record<string, number>>, now: number): string[] {
  return [...room.players.values()].filter((p) => p.active && now - Math.max(seen[p.id] ?? 0, p.since) > GONE_MS).map((p) => p.id);
}

/* -------------------------------------------------------------- view */

export interface PlayerView {
  id: string;
  name: string;
  active: boolean;
  away: boolean;
  wins: number;
}

export interface RoundView {
  index: number;
  seed: string;
  startAt: number;
  endsBy: number;
  players: string[];
  results: Record<string, Result>;
  done: boolean;
  winner: string | null;
}

export interface RoomView {
  code: string;
  game: ArcadeGame;
  version: number;
  now: number;
  host: string | null;
  settings: Settings;
  phase: Phase;
  players: PlayerView[];
  match: { index: number; to: number; winner: string | null; round: RoundView } | null;
}

/** Everything in a versus room is everyone's to see, but the salt and who holds which seat. */
export function viewOf(room: Room, now: number, seen: Readonly<Record<string, number>> = {}): RoomView {
  const match = room.match;
  const players: PlayerView[] = [];
  for (const p of [...room.players.values()].sort((a, b) => a.seq - b.seq)) {
    const playing = match?.round.players.includes(p.id) || match?.wins.has(p.id);
    if (!p.active && !playing) continue;
    players.push({ id: p.id, name: p.name, active: p.active, away: p.active && now - Math.max(seen[p.id] ?? 0, p.since) > AWAY_MS, wins: match?.wins.get(p.id) ?? 0 });
  }
  const round = match?.round;
  return {
    code: room.code,
    game: room.game,
    version: room.version,
    now,
    host: room.host,
    settings: room.settings,
    phase: phaseOf(room, now),
    players,
    match:
      match && round
        ? {
            index: match.index,
            to: match.to,
            winner: match.winner,
            round: { index: round.index, seed: round.seed, startAt: round.startAt, endsBy: round.endsBy, players: round.players, results: Object.fromEntries(round.results), done: round.done, winner: round.winner },
          }
        : null,
  };
}
