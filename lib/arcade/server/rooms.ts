/**
 * What the arcade's versus API does, apart from HTTP. The room is its log
 * (see lib/arcade/room.ts), and a hash, `live`, of how far everyone's got
 * in the round that's on, which goes several times a second while you
 * play: each player says where they've got to and hears where everyone
 * else has, in one request, signed with their seat's key so it needn't
 * read the log (see lib/rooms/seats.ts). A finished run is played back
 * here before its score goes in the log.
 */

import { randomId } from "../../random.ts";
import { CODE_ALPHABET, CODE_LENGTH, cleanName, codeFrom, hashToken } from "../../rooms/codes.ts";
import { RoomError, record } from "../../rooms/http.ts";
import { isPlayerId, seatKey, verify } from "../../rooms/seats.ts";
import type { RoomStore, Seen, StoredRoom } from "../../rooms/store.ts";
import { outcome, type ArcadeGame } from "../games.ts";
import { DEFAULT_SETTINGS, MAX_EVENTS, MAX_PLAYERS, MIN_PLAYERS, ROUND_MS, cleanSettings, gonePlayers, phaseOf, reduce, viewOf, type Room, type RoomView, type VersusEvent } from "../room.ts";

export const ROOM_TTL_SECONDS = 6 * 60 * 60;
/** Someone who's said nothing for this long has stopped playing, or left. */
export const LIVE_FRESH_MS = 3000;
/** The most a live update can say: a whole snake fits with room to spare. */
const LIVE_MAX = 600;

type Store = RoomStore<VersusEvent>;

export interface Identity {
  id: string;
  token: string;
}

export interface Reply {
  room: RoomView;
  now: number;
  you?: Identity;
  /** What your live updates are signed with: only ever sent to you. */
  key?: string;
}

/** Where someone's got to, as they said it, and when the server heard. */
export interface Live {
  data: string;
  t: number;
}

function presence(room: Room, seen: StoredRoom<VersusEvent>["seen"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(seen)) if (room.players.get(id)?.tok === entry.tok) out[id] = entry.at;
  return out;
}

async function load(store: Store, game: ArcadeGame, code: string, now: number) {
  const stored = await store.read(code);
  const room = stored && reduce(stored.events, now);
  if (!stored || !room || room.game !== game) throw new RoomError(404, "there's no room with that code, or it has expired");
  return { stored, room };
}

/** Appends and replays again, reading back only if someone else wrote in between. */
async function commit(store: Store, game: ArcadeGame, code: string, stored: StoredRoom<VersusEvent>, events: VersusEvent[], now: number, seen?: Seen) {
  if (stored.events.length + events.length > MAX_EVENTS) throw new RoomError(409, "this room has been going so long it's full; make a new one");
  const length = await store.append(code, events, ROOM_TTL_SECONDS, seen);
  const mine = { ...stored.seen, ...(seen ? { [seen.player]: { at: seen.at, tok: seen.tok } } : {}) };
  if (length === stored.events.length + events.length) {
    const room = reduce([...stored.events, ...events], now)!;
    return { room, view: viewOf(room, now, presence(room, mine)) };
  }
  const fresh = await load(store, game, code, now);
  return { room: fresh.room, view: viewOf(fresh.room, now, presence(fresh.room, { ...fresh.stored.seen, ...mine })) };
}

export async function createRoom(store: Store, game: ArcadeGame, input: unknown, now: number): Promise<Reply> {
  const name = cleanName(record(input).name);
  if (!name) throw new RoomError(400, "pick a name first");
  const you: Identity = { id: randomId(10), token: randomId(24) };
  const tok = await hashToken(you.token);
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomId(CODE_LENGTH, CODE_ALPHABET);
    const salt = randomId(24);
    const events: VersusEvent[] = [
      // The salt picks every round's course and makes everyone's seat key; it never leaves the server.
      { k: "create", t: now, code, salt, game, settings: { ...DEFAULT_SETTINGS } },
      { k: "join", t: now, p: you.id, name, tok },
    ];
    if (await store.create(code, events, { player: you.id, at: now, tok }, ROOM_TTL_SECONDS)) {
      const room = reduce(events, now)!;
      return { room: viewOf(room, now, { [you.id]: now }), now, you, key: await seatKey(salt, you.id) };
    }
  }
  throw new RoomError(503, "couldn't find a free room code; try again");
}

export async function getRoom(store: Store, game: ArcadeGame, rawCode: unknown, now: number): Promise<RoomView> {
  const code = codeFrom(rawCode);
  const { stored, room } = await load(store, game, code, now);
  const seen = presence(room, stored.seen);
  const gone = gonePlayers(room, seen, now);
  if (gone.length === 0) return viewOf(room, now, seen);
  return (await commit(store, game, code, stored, gone.map((p) => ({ k: "leave", t: now, p, why: "gone" })), now)).view;
}

async function identify(room: Room, body: Record<string, unknown>) {
  const player = typeof body.player === "string" ? room.players.get(body.player) : undefined;
  if (!player || typeof body.token !== "string" || (await hashToken(body.token)) !== player.tok) throw new RoomError(401, "you're not in this room");
  if (player.kicked) throw new RoomError(403, "the host removed you from this room");
  return player;
}

export async function act(store: Store, game: ArcadeGame, rawCode: unknown, input: unknown, now: number): Promise<Reply> {
  const code = codeFrom(rawCode);
  const body = record(input);
  const { stored, room } = await load(store, game, code, now);

  if (body.type === "join") {
    const name = cleanName(body.name);
    if (!name) throw new RoomError(400, "pick a name first");
    const known = typeof body.player === "string" ? room.players.get(body.player) : undefined;
    const token = typeof body.token === "string" ? body.token : "";
    const active = [...room.players.values()].filter((p) => p.active).length;
    if (known && token && (await hashToken(token)) === known.tok) {
      if (known.kicked) throw new RoomError(403, "the host removed you from this room");
      if (!known.active && active >= MAX_PLAYERS) throw new RoomError(409, "this room is full");
      const after = await commit(store, game, code, stored, [{ k: "join", t: now, p: known.id, name, tok: known.tok }], now, { player: known.id, at: now, tok: known.tok });
      return { room: after.view, now, you: { id: known.id, token }, key: await seatKey(room.salt, known.id) };
    }
    if (active >= MAX_PLAYERS) throw new RoomError(409, "this room is full");
    const you: Identity = { id: randomId(10), token: randomId(24) };
    const tok = await hashToken(you.token);
    const after = await commit(store, game, code, stored, [{ k: "join", t: now, p: you.id, name, tok }], now, { player: you.id, at: now, tok });
    return { room: after.view, now, you, key: await seatKey(room.salt, you.id) };
  }

  const player = await identify(room, body);
  const me: Seen = { player: player.id, at: now, tok: player.tok };
  if (!player.active) throw new RoomError(409, "you've left this room; join again first");
  const isHost = room.host === player.id;
  const phase = phaseOf(room, now);

  if (body.type === "me") return { room: viewOf(room, now, presence(room, stored.seen)), now, key: await seatKey(room.salt, player.id) };

  let event: VersusEvent;
  switch (body.type) {
    case "finish": {
      const match = room.match;
      const round = match?.round;
      if (!match || !round || phase !== "playing" || body.match !== match.index || body.round !== round.index) throw new RoomError(409, "that round's over");
      if (!round.players.includes(player.id)) throw new RoomError(409, "you're not in this round");
      if (round.results.has(player.id)) throw new RoomError(409, "you've already finished");
      const elapsed = now - round.startAt;
      const run = outcome(game, round.seed, body.moves, ROUND_MS[game]);
      if (!run) throw new RoomError(400, "those moves don't make a run");
      // Over, or stopped by the clock; and no quicker than it could have been played.
      if (!run.over && elapsed < ROUND_MS[game] - 3000) throw new RoomError(409, "you're still going");
      if (run.ms * 0.8 > elapsed + 2000) throw new RoomError(409, "that run went quicker than it could have");
      event = { k: "finish", t: now, p: player.id, match: match.index, round: round.index, score: run.score, length: run.length };
      break;
    }
    case "settings": {
      if (!isHost) throw new RoomError(403, "only the host can change the settings");
      if (phase !== "lobby" && phase !== "over") throw new RoomError(409, "wait for this match to finish");
      const settings = cleanSettings(body.settings);
      if (!settings) throw new RoomError(400, "those settings aren't allowed");
      event = { k: "settings", t: now, p: player.id, settings };
      break;
    }
    case "start":
      if (!isHost) throw new RoomError(403, "only the host can start");
      if (phase === "countdown" || phase === "playing") throw new RoomError(409, "a round's already going");
      if ([...room.players.values()].filter((p) => p.active).length < MIN_PLAYERS) throw new RoomError(409, "you need someone to play against");
      event = { k: "start", t: now, p: player.id };
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

  const after = await commit(store, game, code, stored, [event], now, me);
  return { room: after.view, now };
}

/**
 * Where you've got to this round, signed, and where everyone else has: a
 * few times a second while you play. The answer leaves you out, and
 * anyone who's gone quiet.
 */
export async function live(store: Store, game: ArcadeGame, rawCode: unknown, input: unknown, now: number): Promise<{ now: number; live: Record<string, Live> }> {
  const code = codeFrom(rawCode);
  const { player, data, mac } = record(input);
  if (!isPlayerId(player) || typeof data !== "string" || data.length > LIVE_MAX || typeof mac !== "string" || mac.length > 100) throw new RoomError(400, "that request made no sense");
  await verify(store, game, code, "live", player, data, mac);
  const all = await store.swap(code, "live", player, JSON.stringify({ data, t: now }), ROOM_TTL_SECONDS);
  const others: Record<string, Live> = {};
  for (const [id, value] of Object.entries(all)) {
    if (id === player) continue;
    try {
      const entry = JSON.parse(value) as Live;
      if (typeof entry.data === "string" && typeof entry.t === "number" && now - entry.t < LIVE_FRESH_MS) others[id] = entry;
    } catch {
      // Damage; skip it.
    }
  }
  return { now, live: others };
}

/** A player saying they're still here: one hash write, checked by whoever reads it (see geo's ping). */
export async function ping(store: Store, rawCode: unknown, input: unknown, now: number): Promise<{ now: number }> {
  const code = codeFrom(rawCode);
  const { player, token } = record(input);
  if (!isPlayerId(player) || typeof token !== "string" || token.length > 64) throw new RoomError(401, "you're not in this room");
  await store.touch(code, { player, at: now, tok: await hashToken(token) }, ROOM_TTL_SECONDS);
  return { now };
}
