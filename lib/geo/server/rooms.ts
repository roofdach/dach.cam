/**
 * What the multiplayer API does, apart from HTTP: every request reads the
 * room's log, replays it, checks the request makes sense right now, then
 * appends to the log. The replay is the only judge of what happened; the
 * checks here are just so people get a useful error instead of silence.
 */

import { randomId } from "../random.ts";
import {
  DEFAULT_SETTINGS,
  GRACE_MS,
  MAX_EVENTS,
  MAX_PLAYERS,
  cleanName,
  gonePlayers,
  isPlace,
  isSettings,
  phaseOf,
  reduce,
  viewOf,
  type Room,
  type RoomEvent,
  type RoomView,
} from "../room.ts";
import type { RoomStore, Seen, StoredRoom } from "./store.ts";

/** Rooms are forgotten this long after anyone last did anything in them. */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;

/** No vowels, so a code can't spell anything. */
export const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const CODE_PATTERN = /^[BCDFGHJKLMNPQRSTVWXZ]{5}$/;

export class RoomError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RoomError";
    this.status = status;
  }
}

export interface Identity {
  id: string;
  /** A secret only this player's browser knows; the room keeps just its hash. */
  token: string;
}

export interface RoomReply {
  room: RoomView;
  now: number;
  you?: Identity;
}

async function hash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoomError(400, "that request made no sense");
  return value as Record<string, unknown>;
}

function codeFrom(value: unknown): string {
  const code = typeof value === "string" ? value.toUpperCase() : "";
  if (!CODE_PATTERN.test(code)) throw new RoomError(404, "there's no room with that code");
  return code;
}

async function load(store: RoomStore, code: string, now: number): Promise<{ stored: StoredRoom; room: Room }> {
  const stored = await store.read(code);
  const room = stored && reduce(stored.events, now);
  if (!stored || !room) throw new RoomError(404, "there's no room with that code, or it has expired");
  return { stored, room };
}

/** When each player was last heard from, counting only signs of life signed with their own secret. */
function presence(room: Room, seen: StoredRoom["seen"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(seen)) {
    if (room.players.get(id)?.tok === entry.tok) out[id] = entry.at;
  }
  return out;
}

/** Appends and replays again, reading back the log only if someone else wrote in between. */
async function commit(
  store: RoomStore,
  code: string,
  stored: StoredRoom,
  events: RoomEvent[],
  now: number,
  seen?: Seen,
): Promise<{ room: Room; seen: Record<string, number> }> {
  if (stored.events.length + events.length > MAX_EVENTS) {
    throw new RoomError(409, "this room has been going so long it's full; make a new one");
  }
  const length = await store.append(code, events, ROOM_TTL_SECONDS, seen);
  const mine = { ...stored.seen, ...(seen ? { [seen.player]: { at: seen.at, tok: seen.tok } } : {}) };
  if (length === stored.events.length + events.length) {
    const room = reduce([...stored.events, ...events], now)!;
    return { room, seen: presence(room, mine) };
  }
  const fresh = await load(store, code, now);
  return { room: fresh.room, seen: presence(fresh.room, { ...fresh.stored.seen, ...mine }) };
}

export async function createRoom(store: RoomStore, input: unknown, now: number): Promise<RoomReply> {
  const name = cleanName(record(input).name);
  if (!name) throw new RoomError(400, "pick a name first");

  const you: Identity = { id: randomId(10), token: randomId(24) };
  const tok = await hash(you.token);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomId(5, CODE_ALPHABET);
    const events: RoomEvent[] = [
      { k: "create", t: now, code, settings: { ...DEFAULT_SETTINGS } },
      { k: "join", t: now, p: you.id, name, tok },
    ];
    if (await store.create(code, events, { player: you.id, at: now, tok }, ROOM_TTL_SECONDS)) {
      return { room: viewOf(reduce(events, now)!, now, { [you.id]: now }), now, you };
    }
  }
  throw new RoomError(503, "couldn't find a free room code; try again");
}

/** A room as everyone sees it, letting go of anyone who has been silent too long. */
export async function getRoom(store: RoomStore, rawCode: unknown, now: number): Promise<RoomView> {
  const code = codeFrom(rawCode);
  const { stored, room } = await load(store, code, now);
  const seen = presence(room, stored.seen);
  const gone = gonePlayers(room, seen, now);
  if (gone.length === 0) return viewOf(room, now, seen);
  const events: RoomEvent[] = gone.map((p) => ({ k: "leave", t: now, p, why: "gone" }));
  const after = await commit(store, code, stored, events, now);
  return viewOf(after.room, now, after.seen);
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const whole = (value: unknown): value is number => Number.isInteger(value);

export async function act(store: RoomStore, rawCode: unknown, input: unknown, now: number): Promise<RoomReply> {
  const code = codeFrom(rawCode);
  const body = record(input);
  const { stored, room } = await load(store, code, now);

  if (body.type === "join") {
    const name = cleanName(body.name);
    if (!name) throw new RoomError(400, "pick a name first");
    const known = typeof body.player === "string" ? room.players.get(body.player) : undefined;
    const token = typeof body.token === "string" ? body.token : "";
    if (known && token && (await hash(token)) === known.tok) {
      if (known.kicked) throw new RoomError(403, "the host removed you from this room");
      const active = [...room.players.values()].filter((p) => p.active).length;
      if (!known.active && active >= MAX_PLAYERS) throw new RoomError(409, "this room is full");
      const event: RoomEvent = { k: "join", t: now, p: known.id, name, tok: known.tok };
      const after = await commit(store, code, stored, [event], now, { player: known.id, at: now, tok: known.tok });
      return { room: viewOf(after.room, now, after.seen), now, you: { id: known.id, token } };
    }
    const active = [...room.players.values()].filter((p) => p.active).length;
    if (active >= MAX_PLAYERS) throw new RoomError(409, "this room is full");
    const you: Identity = { id: randomId(10), token: randomId(24) };
    const tok = await hash(you.token);
    const event: RoomEvent = { k: "join", t: now, p: you.id, name, tok };
    const after = await commit(store, code, stored, [event], now, { player: you.id, at: now, tok });
    return { room: viewOf(after.room, now, after.seen), now, you };
  }

  // Everything else has to come from someone in the room.
  const player = typeof body.player === "string" ? room.players.get(body.player) : undefined;
  if (!player || typeof body.token !== "string" || (await hash(body.token)) !== player.tok) {
    throw new RoomError(401, "you're not in this room");
  }
  if (player.kicked) throw new RoomError(403, "the host removed you from this room");
  const me: Seen = { player: player.id, at: now, tok: player.tok };

  if (!player.active) throw new RoomError(409, "you've left this room; join again first");
  const isHost = room.host === player.id;
  const lobby = !room.game || room.game.finished;
  const phase = phaseOf(room, now);
  let event: RoomEvent;

  switch (body.type) {
    case "settings":
      if (!isHost) throw new RoomError(403, "only the host can change the settings");
      if (!lobby) throw new RoomError(409, "wait for this game to finish");
      if (!isSettings(body.settings)) throw new RoomError(400, "those settings aren't allowed");
      event = { k: "settings", t: now, p: player.id, settings: body.settings };
      break;

    case "start": {
      if (!isHost) throw new RoomError(403, "only the host can start a game");
      if (!lobby) throw new RoomError(409, "a game is already going");
      if (!isSettings(body.settings)) throw new RoomError(400, "those settings aren't allowed");
      const places = body.places;
      if (!Array.isArray(places) || places.length !== body.settings.rounds || !places.every(isPlace)) {
        throw new RoomError(400, "those places don't look right");
      }
      event = { k: "start", t: now, p: player.id, settings: body.settings, places };
      break;
    }

    case "guess": {
      const game = room.game;
      if (!game || body.g !== game.index || body.r !== game.current) throw new RoomError(409, "that round is over");
      if (!finite(body.lat) || !finite(body.lng) || Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
        throw new RoomError(400, "that guess isn't on the map");
      }
      const round = game.rounds[game.current];
      if (round.guesses.has(player.id)) throw new RoomError(409, "you've already guessed");
      if (phase === "countdown") throw new RoomError(409, "the round hasn't started yet");
      if (round.end !== null && (round.early || now > round.deadline + GRACE_MS)) throw new RoomError(409, "that round is over");
      event = { k: "guess", t: now, p: player.id, g: game.index, r: game.current, lat: body.lat, lng: body.lng };
      break;
    }

    case "next": {
      const game = room.game;
      if (!isHost) throw new RoomError(403, "only the host can move things on");
      if (!game || !whole(body.g) || !whole(body.r) || body.g !== game.index || body.r !== game.current || phase !== "results") {
        throw new RoomError(409, "there's nothing to skip");
      }
      event = { k: "next", t: now, p: player.id, g: body.g, r: body.r };
      break;
    }

    case "lobby":
      if (!isHost) throw new RoomError(403, "only the host can end the game");
      if (!room.game) throw new RoomError(409, "there's no game to end");
      event = { k: "lobby", t: now, p: player.id, g: room.game.index };
      break;

    case "kick": {
      if (!isHost) throw new RoomError(403, "only the host can remove people");
      const target = typeof body.target === "string" ? room.players.get(body.target) : undefined;
      if (!target?.active || target.id === player.id) throw new RoomError(409, "they aren't here");
      event = { k: "leave", t: now, p: target.id, why: "kicked", by: player.id };
      break;
    }

    case "leave":
      event = { k: "leave", t: now, p: player.id, why: "left", by: player.id };
      break;

    default:
      throw new RoomError(400, "that request made no sense");
  }

  const after = await commit(store, code, stored, [event], now, me);
  return { room: viewOf(after.room, now, after.seen), now };
}

/**
 * A player saying they're still here. It is the most frequent request by far,
 * so it writes one hash field and reads nothing: the hash of the player's
 * secret goes along with it, and whoever reads the room ignores any sign of
 * life that doesn't match. The reply is just the server's clock.
 */
export async function ping(store: RoomStore, rawCode: unknown, input: unknown, now: number): Promise<{ now: number }> {
  const code = codeFrom(rawCode);
  const { player, token } = record(input);
  if (typeof player !== "string" || !/^[a-z0-9]{1,24}$/.test(player) || typeof token !== "string" || token.length > 64) {
    throw new RoomError(401, "you're not in this room");
  }
  await store.touch(code, { player, at: now, tok: await hash(token) }, ROOM_TTL_SECONDS);
  return { now };
}
