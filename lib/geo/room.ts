/**
 * A multiplayer room, as a pure function of its history.
 *
 * The server keeps nothing but an append-only log of what happened in a room
 * (who joined, what the host started, who guessed where), each entry stamped
 * with the server's clock. Anything else, such as whose turn it is, when a
 * round ends or who is winning, is worked out by replaying the log with
 * `reduce`. Appending never has to read first, so players guessing at the
 * same moment can't overwrite each other, and a replay always agrees with
 * itself.
 *
 * Time moves on without anyone doing anything: a round ends at its deadline,
 * results give way to the next round after a while. So `reduce` also takes
 * the current time, and everything is a deterministic function of the log
 * and the clock.
 */

import { MAP_SCALES } from "./data/scales.ts";
import { COUNTRY_NAMES } from "./countries.ts";
import { haversineKm } from "./earth.ts";
import { isMapId, type MapId } from "./maps.ts";
import { cleanName } from "../rooms/codes.ts";
import { pointsFor } from "./score.ts";

export { cleanName };
import type { Place } from "./types.ts";

export const ROUND_CHOICES = [3, 5, 10] as const;
/** Seconds a round lasts. */
export const TIME_CHOICES = [30, 60, 90, 120, 180, 300] as const;

export interface Settings {
  map: MapId;
  rounds: number;
  /** Seconds per round. */
  time: number;
}

export const DEFAULT_SETTINGS: Settings = { map: "world", rounds: 5, time: 90 };

/** "Get ready" before the first round: long enough for everyone's next poll to hear about it and load the panorama. */
export const COUNTDOWN_MS = 5000;
/** How long a round's results stay up before the next one starts, unless the host skips. */
export const RESULTS_MS = 15000;
/** A guess sent in the last moment may arrive this late and still count. */
export const GRACE_MS = 2000;
export const MAX_PLAYERS = 50;
/** Without a sign of life for this long a player shows as away (browsers ping every twenty seconds)... */
export const AWAY_MS = 30_000;
/** ...and after this long they are taken out of the room, until they come back. */
export const GONE_MS = 60_000;
/** A room's log never grows past this; by then it has hosted dozens of games. */
export const MAX_EVENTS = 4000;

export type RoomEvent =
  | { k: "create"; t: number; code: string; settings: Settings }
  | { k: "join"; t: number; p: string; name: string; tok: string }
  /** `by` is who asked: the player themselves, the host for a kick, or nobody when the server lets someone go. */
  | { k: "leave"; t: number; p: string; why: "left" | "gone" | "kicked"; by?: string }
  | { k: "settings"; t: number; p: string; settings: Settings }
  | { k: "start"; t: number; p: string; settings: Settings; places: Place[] }
  | { k: "guess"; t: number; p: string; g: number; r: number; lat: number; lng: number }
  | { k: "next"; t: number; p: string; g: number; r: number }
  | { k: "lobby"; t: number; p: string; g: number };

export interface Player {
  id: string;
  name: string;
  /** SHA-256 of the player's secret, which proves later requests are theirs. */
  tok: string;
  /** Order of first arrival; the earliest player still here is the host. */
  seq: number;
  active: boolean;
  kicked: boolean;
  /** When they last (re)joined. */
  since: number;
}

export interface Guess {
  lat: number;
  lng: number;
  t: number;
  km: number;
  points: number;
}

export interface Round {
  start: number;
  deadline: number;
  /** When the round stopped taking guesses; null while it's on. */
  end: number | null;
  /** Ended because everyone had guessed, rather than at the deadline. */
  early: boolean;
  /** When the results give way to what comes next. */
  next: number | null;
  guesses: Map<string, Guess>;
}

export interface Game {
  index: number;
  settings: Settings;
  places: Place[];
  rounds: Round[];
  /** Index of the round in progress, or of the last one once finished. */
  current: number;
  finished: boolean;
}

export interface Room {
  code: string;
  created: number;
  settings: Settings;
  players: Map<string, Player>;
  host: string | null;
  game: Game | null;
  games: number;
  /** The latest moment the room has been brought up to. */
  clock: number;
  /** How many events built this state. */
  version: number;
}

export type Phase = "lobby" | "countdown" | "playing" | "results" | "final";

/* ----------------------------------------------------------- checking */

export function isSettings(value: unknown): value is Settings {
  if (!value || typeof value !== "object") return false;
  const { map, rounds, time } = value as Record<string, unknown>;
  return (
    isMapId(map) &&
    (ROUND_CHOICES as readonly unknown[]).includes(rounds) &&
    (TIME_CHOICES as readonly unknown[]).includes(time)
  );
}

export function isPlace(value: unknown): value is Place {
  if (!value || typeof value !== "object") return false;
  const { lat, lng, pano, heading, country, date } = value as Record<string, unknown>;
  return (
    typeof lat === "number" &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === "number" &&
    lng >= -180 &&
    lng <= 180 &&
    typeof pano === "string" &&
    /^[\w-]{22}$/.test(pano) &&
    typeof heading === "number" &&
    heading >= 0 &&
    heading < 360 &&
    typeof country === "string" &&
    Object.hasOwn(COUNTRY_NAMES, country) &&
    (date === undefined || (typeof date === "string" && /^\d{4}-\d{2}$/.test(date)))
  );
}


/* ------------------------------------------------------------ replay */

function activeCount(room: Room) {
  let n = 0;
  for (const player of room.players.values()) if (player.active) n++;
  return n;
}

function electHost(room: Room) {
  let host: Player | null = null;
  for (const player of room.players.values()) {
    if (player.active && (!host || player.seq < host.seq)) host = player;
  }
  room.host = host?.id ?? null;
}

function newRound(start: number, settings: Settings): Round {
  return { start, deadline: start + settings.time * 1000, end: null, early: false, next: null, guesses: new Map() };
}

/** Brings the room's timeline up to `t`: rounds end at their deadlines, results give way. */
function advance(room: Room, t: number) {
  if (t > room.clock) room.clock = t;
  const game = room.game;
  if (!game) return;
  const now = room.clock;
  while (!game.finished) {
    const round = game.rounds[game.current];
    if (round.end === null) {
      if (now < round.deadline) return;
      round.end = round.deadline;
      round.next = round.deadline + RESULTS_MS;
    }
    if (round.next === null || now < round.next) return;
    if (game.current + 1 >= game.settings.rounds) {
      game.finished = true;
      return;
    }
    game.rounds.push(newRound(round.next, game.settings));
    game.current++;
  }
}

/** Ends the round on the spot once everyone still here has guessed. */
function settleEarly(room: Room) {
  const game = room.game;
  if (!game || game.finished) return;
  const round = game.rounds[game.current];
  if (round.end !== null || room.clock < round.start) return;
  let present = 0;
  for (const player of room.players.values()) {
    if (!player.active) continue;
    present++;
    if (!round.guesses.has(player.id)) return;
  }
  if (present === 0) return;
  round.end = room.clock;
  round.early = true;
  round.next = room.clock + RESULTS_MS;
}

function inLobby(room: Room) {
  return !room.game || room.game.finished;
}

function apply(room: Room, event: RoomEvent) {
  advance(room, event.t);
  const t = room.clock;
  const player = "p" in event ? room.players.get(event.p) : undefined;
  const isHost = player !== undefined && player.id === room.host;

  switch (event.k) {
    case "create":
      return;

    case "join": {
      const name = cleanName(event.name);
      if (!name) return;
      if (player) {
        if (player.kicked || player.tok !== event.tok) return;
        if (!player.active && activeCount(room) >= MAX_PLAYERS) return;
        player.active = true;
        player.name = name;
        player.since = t;
      } else {
        if (activeCount(room) >= MAX_PLAYERS) return;
        room.players.set(event.p, {
          id: event.p,
          name,
          tok: event.tok,
          seq: room.players.size,
          active: true,
          kicked: false,
          since: t,
        });
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
      settleEarly(room);
      return;
    }

    case "settings": {
      if (!isHost || !inLobby(room) || !isSettings(event.settings)) return;
      room.settings = { ...event.settings };
      return;
    }

    case "start": {
      if (!isHost || !inLobby(room) || !isSettings(event.settings)) return;
      const { settings, places } = event;
      if (!Array.isArray(places) || places.length !== settings.rounds || !places.every(isPlace)) return;
      room.settings = { ...settings };
      room.games++;
      room.game = {
        index: room.games,
        settings: { ...settings },
        places: places.map((p) => ({ ...p })),
        rounds: [newRound(t + COUNTDOWN_MS, settings)],
        current: 0,
        finished: false,
      };
      return;
    }

    case "guess": {
      const game = room.game;
      if (!game || game.finished || event.g !== game.index || event.r !== game.current || !player?.active) return;
      const round = game.rounds[game.current];
      if (t < round.start || round.guesses.has(player.id)) return;
      if (round.end !== null && (round.early || t > round.deadline + GRACE_MS)) return;
      if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng) || Math.abs(event.lat) > 90 || Math.abs(event.lng) > 180) {
        return;
      }
      const place = game.places[game.current];
      const km = haversineKm(event.lat, event.lng, place.lat, place.lng);
      round.guesses.set(player.id, {
        lat: event.lat,
        lng: event.lng,
        t,
        km,
        points: pointsFor(km, MAP_SCALES[game.settings.map]),
      });
      settleEarly(room);
      return;
    }

    case "next": {
      const game = room.game;
      if (!isHost || !game || game.finished || event.g !== game.index || event.r !== game.current) return;
      const round = game.rounds[game.current];
      if (round.end === null || round.next === null || t >= round.next) return;
      round.next = t;
      advance(room, t);
      return;
    }

    case "lobby": {
      if (!isHost || !room.game || event.g !== room.game.index) return;
      room.game = null;
      return;
    }
  }
}

/** Replays a room's log up to `now`. Null if the log isn't a room. */
export function reduce(events: readonly RoomEvent[], now: number): Room | null {
  const first = events[0];
  if (!first || first.k !== "create") return null;
  const room: Room = {
    code: first.code,
    created: first.t,
    settings: isSettings(first.settings) ? { ...first.settings } : { ...DEFAULT_SETTINGS },
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

export function phaseOf(room: Room, now = room.clock): Phase {
  const game = room.game;
  if (!game) return "lobby";
  if (game.finished) return "final";
  const round = game.rounds[game.current];
  if (now < round.start) return "countdown";
  return round.end === null ? "playing" : "results";
}

/** Active players nobody has heard from in a while, who should be let go. */
export function gonePlayers(room: Room, seen: Readonly<Record<string, number>>, now: number): string[] {
  const gone: string[] = [];
  for (const player of room.players.values()) {
    if (!player.active) continue;
    const last = Math.max(seen[player.id] ?? 0, player.since);
    if (now - last > GONE_MS) gone.push(player.id);
  }
  return gone;
}

/* -------------------------------------------------------------- view */

/** Colours for pins, in join order; picked to stay apart on a light map. */
export const PLAYER_COLORS = [
  "#d9480f",
  "#1c7ed6",
  "#2b8a3e",
  "#ae3ec9",
  "#f08c00",
  "#0c8599",
  "#c2255c",
  "#5f3dc4",
  "#66a80f",
  "#495057",
  "#e8590c",
  "#1971c2",
];

export interface PlayerView {
  id: string;
  name: string;
  color: string;
  active: boolean;
  away: boolean;
}

export interface GuessView {
  player: string;
  lat: number;
  lng: number;
  km: number;
  points: number;
}

export interface RoundView {
  start: number;
  deadline: number;
  end: number | null;
  next: number | null;
  /** Where the round is; the coordinates only once it's over. */
  place: Pick<Place, "pano" | "heading"> & Partial<Place>;
  /** Who has guessed so far. */
  guessed: string[];
  /** Everyone's guesses, once the round is over. */
  guesses: GuessView[] | null;
}

export interface GameView {
  index: number;
  settings: Settings;
  phase: Exclude<Phase, "lobby">;
  current: number;
  rounds: RoundView[];
  /** The next round's panorama, during results, so it can load early. */
  upcoming: Pick<Place, "pano" | "heading"> | null;
  /** Points per player from finished rounds. */
  totals: Record<string, number>;
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

/**
 * What everyone in the room may see. The same for every player, so it can be
 * cached, and it holds back what would help a cheat: where the round is and
 * where others guessed, until the round is over.
 */
export function viewOf(room: Room, now: number, seen: Readonly<Record<string, number>> = {}): RoomView {
  const game = room.game;
  const inGame = new Set<string>();
  if (game) for (const round of game.rounds) for (const id of round.guesses.keys()) inGame.add(id);

  const taken = new Map<string, number>();
  const players: PlayerView[] = [];
  const ordered = [...room.players.values()].sort((a, b) => a.seq - b.seq);
  for (const player of ordered) {
    if (!player.active && !inGame.has(player.id)) continue;
    // Two people called sam become "sam" and "sam 2".
    const key = player.name.toLocaleLowerCase("en");
    const count = (taken.get(key) ?? 0) + 1;
    taken.set(key, count);
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
    const totals: Record<string, number> = {};
    const rounds = game.rounds.map((round, i): RoundView => {
      const over = round.end !== null && now >= round.end;
      const place = game.places[i];
      if (over) for (const [id, guess] of round.guesses) totals[id] = (totals[id] ?? 0) + guess.points;
      return {
        start: round.start,
        deadline: round.deadline,
        end: round.end,
        next: round.next,
        place: over ? { ...place } : { pano: place.pano, heading: place.heading },
        guessed: [...round.guesses.keys()],
        guesses: over
          ? [...round.guesses].map(([player, g]) => ({ player, lat: g.lat, lng: g.lng, km: g.km, points: g.points }))
          : null,
      };
    });
    const phase = phaseOf(room, now) as GameView["phase"];
    const nextPlace = game.places[game.current + 1];
    gameView = {
      index: game.index,
      settings: { ...game.settings },
      phase,
      current: game.current,
      rounds,
      upcoming: phase === "results" && nextPlace ? { pano: nextPlace.pano, heading: nextPlace.heading } : null,
      totals,
    };
  }

  return {
    code: room.code,
    version: room.version,
    now,
    host: room.host,
    settings: { ...room.settings },
    players,
    game: gameView,
  };
}
