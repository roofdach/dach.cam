/**
 * What the among us API does, apart from HTTP. The room is its log (see
 * lib/sus/room.ts), one side list, `chat`, for what's said at meetings,
 * and a hash, `pos`, of where everyone's standing.
 *
 * Nearly everything in a game is secret from someone, but everyone gets the
 * same copy of the room so the CDN can share it (see lib/rooms/http.ts). So
 * each player's own view travels in it sealed, with a key of their own that
 * only they are given (see lib/draw/secret.ts): everyone gets everyone's,
 * and can open only theirs. Every view is padded to the same length, give
 * or take, so nobody can tell an impostor's from its size, and sealed afresh
 * each time, so nobody can tell whose changed when. What the dead say at a
 * meeting is sealed the same way, with a key only the dead are given.
 *
 * Where everyone is, moment to moment, goes through `pos` several times a
 * second: each player says where they are and hears where everyone else
 * is, in one request. Those come far too often to read the log each time,
 * so they're signed with the player's own key instead, which only needs
 * the room's salt. The same hash carries the room's version whenever
 * something happens that everyone should see at once, a kill or a meeting
 * or an alarm, so browsers know to look at the room straight away rather
 * than at their next poll.
 */

import { randomId } from "../../random.ts";
import { seal } from "../../draw/secret.ts";
import { CODE_ALPHABET, CODE_LENGTH, cleanName, codeFrom, hashToken } from "../../rooms/codes.ts";
import { RoomError, record } from "../../rooms/http.ts";
import { digest, isPlayerId, seatKey, verify } from "../../rooms/seats.ts";
import type { ListRead, RoomStore, Seen, StoredRoom } from "../../rooms/store.ts";
import {
  DEFAULT_SETTINGS,
  MAX_EVENTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  cleanSettings,
  gonePlayers,
  phaseOf,
  privateView,
  reduce,
  viewOf,
  zoneReachable,
  type Me,
  type Room,
  type RoomView,
  type SusEvent,
} from "../room.ts";
import { SPOTS, TASK_BY_ID, VENT_BY_ID, hops, isZone } from "../ship.ts";
import { KILL_RANGE } from "../space.ts";

export const ROOM_TTL_SECONDS = 6 * 60 * 60;
/** How many chat lines a room shows. */
export const CHAT_LINES = 60;
export const MAX_MESSAGE = 120;
/** Every sealed view is padded out to a multiple of this many characters. */
const PAD = 512;
/** A position is shown for this long after it was sent, then taken as gone: someone who's stopped saying where they are has left, or is a ghost, or is in a vent. */
export const POS_FRESH_MS = 2500;
/** How far off a kill can be, going by where the two last said they were: more than the game allows, for the moment it takes to say. */
export const KILL_REACH = KILL_RANGE * 2.5;
/** The field of `pos` that holds the room's version; no player's id looks like it. */
const VERSION = "_v";
/** What everyone should hear about straight away, rather than at their next poll. */
const LOUD = new Set<SusEvent["k"]>(["kill", "report", "button", "sabotage", "fix"]);

type Store = RoomStore<SusEvent>;

export interface Identity {
  id: string;
  token: string;
}

export interface ChatLine {
  t: number;
  p: string;
  /** The name at the time. */
  n: string;
  /** What they said; for the dead, what it looks like sealed. */
  text: string;
  /** Which game and meeting it was said at. */
  g: number;
  m: number;
  /** Said by the dead, sealed with the key only they have, and the seal's nonce. */
  iv?: string;
}

export interface Sealed {
  iv: string;
  box: string;
}

/** Where someone last said they were. */
export interface Position {
  x: number;
  y: number;
  /** Which way they face: 1 right, -1 left. */
  f: number;
  /** Whether they're walking. */
  m: number;
  /** 0 out and about, 1 hidden in a vent, 2 a ghost, whom only ghosts see. */
  v: number;
  /** When the server heard it. */
  t: number;
}

export interface SusView extends RoomView {
  chat: ChatLine[];
  /** Everyone's own view, each sealed so only they can open it. */
  seals: Record<string, Sealed>;
}

/** Your own view, and the key to the dead's chat once you're one of them. */
export type Mine = Me & { ghostKey: string | null };

export interface Reply {
  room: SusView;
  now: number;
  you?: Identity;
  /** The key your view is sealed with, and your positions signed with: only ever sent to you. */
  key?: string;
  mine?: Mine | null;
}

// The checks sign as the browser does.
export { seatKey, sign } from "../../rooms/seats.ts";

/** The key the dead talk to each other with, this game. */
export const ghostKey = (salt: string, game: number) => digest(`${salt}:ghosts:${game}`);

async function mineOf(room: Room, player: string): Promise<Mine | null> {
  const me = privateView(room, player);
  return me && { ...me, ghostKey: me.alive ? null : await ghostKey(room.salt, me.game) };
}

async function sealAll(room: Room): Promise<Record<string, Sealed>> {
  const seals: Record<string, Sealed> = {};
  if (!room.game) return seals;
  await Promise.all(
    [...room.game.agents.keys()].map(async (id) => {
      const text = JSON.stringify(await mineOf(room, id));
      seals[id] = await seal(await seatKey(room.salt, id), text.padEnd(Math.ceil(text.length / PAD) * PAD, " "));
    }),
  );
  return seals;
}

function parseChat(lines: string[]): ChatLine[] {
  const out: ChatLine[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ChatLine;
      if (typeof entry.t === "number" && typeof entry.p === "string" && typeof entry.n === "string" && typeof entry.text === "string" && Number.isInteger(entry.g) && Number.isInteger(entry.m)) out.push(entry);
    } catch {
      // Damage; skip it.
    }
  }
  return out;
}

/** The positions heard from recently, by player. */
function parsePositions(fields: Record<string, string>, now: number): Record<string, Position> {
  const out: Record<string, Position> = {};
  for (const [id, value] of Object.entries(fields)) {
    try {
      const entry = JSON.parse(value) as Position;
      if (id !== VERSION && [entry.x, entry.y, entry.f, entry.m, entry.v, entry.t].every(Number.isFinite) && now - entry.t < POS_FRESH_MS) out[id] = entry;
    } catch {
      // Damage; skip it.
    }
  }
  return out;
}

/** Tidies a chat message, or null if nothing's left. */
export function cleanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/g, " ").trim();
  const short = Array.from(text).slice(0, MAX_MESSAGE).join("").trim();
  return short.length > 0 ? short : null;
}

function presence(room: Room, seen: StoredRoom<SusEvent>["seen"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(seen)) if (room.players.get(id)?.tok === entry.tok) out[id] = entry.at;
  return out;
}

const CHAT: ListRead = { name: "chat", from: -CHAT_LINES };

async function load(store: Store, code: string, now: number) {
  const stored = await store.read(code, [CHAT], ["pos"]);
  const room = stored && reduce(stored.events, now);
  if (!stored || !room) throw new RoomError(404, "there's no room with that code, or it has expired");
  return { stored, room };
}

async function assemble(room: Room, now: number, seen: Record<string, number>, stored: Pick<StoredRoom<SusEvent>, "lists">): Promise<SusView> {
  return { ...viewOf(room, now, seen), chat: parseChat(stored.lists.chat ?? []), seals: await sealAll(room) };
}

/** Appends and replays again, reading back only if someone else wrote in between. */
async function commit(store: Store, code: string, stored: StoredRoom<SusEvent>, events: SusEvent[], now: number, seen?: Seen) {
  if (stored.events.length + events.length > MAX_EVENTS) throw new RoomError(409, "this room has been going so long it's full; make a new one");
  const length = await store.append(code, events, ROOM_TTL_SECONDS, seen);
  const mine = { ...stored.seen, ...(seen ? { [seen.player]: { at: seen.at, tok: seen.tok } } : {}) };
  if (length === stored.events.length + events.length) {
    const room = reduce([...stored.events, ...events], now)!;
    return { room, view: await assemble(room, now, presence(room, mine), stored) };
  }
  const fresh = await load(store, code, now);
  return { room: fresh.room, view: await assemble(fresh.room, now, presence(fresh.room, { ...fresh.stored.seen, ...mine }), fresh.stored) };
}

export async function createRoom(store: Store, input: unknown, now: number): Promise<Reply> {
  const name = cleanName(record(input).name);
  if (!name) throw new RoomError(400, "pick a name first");
  const you: Identity = { id: randomId(10), token: randomId(24) };
  const tok = await hashToken(you.token);
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomId(CODE_LENGTH, CODE_ALPHABET);
    const salt = randomId(24);
    const events: SusEvent[] = [
      // The salt decides who's an impostor and seals everyone's view; it never leaves the server.
      { k: "create", t: now, code, salt, settings: { ...DEFAULT_SETTINGS } },
      { k: "join", t: now, p: you.id, name, tok },
    ];
    if (await store.create(code, events, { player: you.id, at: now, tok }, ROOM_TTL_SECONDS)) {
      const room = reduce(events, now)!;
      return { room: await assemble(room, now, { [you.id]: now }, { lists: {} }), now, you, key: await seatKey(salt, you.id), mine: null };
    }
  }
  throw new RoomError(503, "couldn't find a free room code; try again");
}

export async function getRoom(store: Store, rawCode: unknown, now: number): Promise<SusView> {
  const code = codeFrom(rawCode);
  const { stored, room } = await load(store, code, now);
  const seen = presence(room, stored.seen);
  const gone = gonePlayers(room, seen, now);
  if (gone.length === 0) return assemble(room, now, seen, stored);
  return (await commit(store, code, stored, gone.map((p) => ({ k: "leave", t: now, p, why: "gone" })), now)).view;
}

async function identify(room: Room, body: Record<string, unknown>) {
  const player = typeof body.player === "string" ? room.players.get(body.player) : undefined;
  if (!player || typeof body.token !== "string" || (await hashToken(body.token)) !== player.tok) throw new RoomError(401, "you're not in this room");
  if (player.kicked) throw new RoomError(403, "the host removed you from this room");
  return player;
}

export async function act(store: Store, rawCode: unknown, input: unknown, now: number): Promise<Reply> {
  const code = codeFrom(rawCode);
  const body = record(input);
  const { stored, room } = await load(store, code, now);

  if (body.type === "join") {
    const name = cleanName(body.name);
    if (!name) throw new RoomError(400, "pick a name first");
    const known = typeof body.player === "string" ? room.players.get(body.player) : undefined;
    const token = typeof body.token === "string" ? body.token : "";
    const active = [...room.players.values()].filter((p) => p.active).length;
    if (known && token && (await hashToken(token)) === known.tok) {
      if (known.kicked) throw new RoomError(403, "the host removed you from this room");
      if (!known.active && active >= MAX_PLAYERS) throw new RoomError(409, "this room is full");
      const after = await commit(store, code, stored, [{ k: "join", t: now, p: known.id, name, tok: known.tok }], now, { player: known.id, at: now, tok: known.tok });
      return { room: after.view, now, you: { id: known.id, token }, key: await seatKey(room.salt, known.id), mine: await mineOf(after.room, known.id) };
    }
    if (active >= MAX_PLAYERS) throw new RoomError(409, "this room is full");
    const you: Identity = { id: randomId(10), token: randomId(24) };
    const tok = await hashToken(you.token);
    const after = await commit(store, code, stored, [{ k: "join", t: now, p: you.id, name, tok }], now, { player: you.id, at: now, tok });
    return { room: after.view, now, you, key: await seatKey(room.salt, you.id), mine: await mineOf(after.room, you.id) };
  }

  const player = await identify(room, body);
  const me: Seen = { player: player.id, at: now, tok: player.tok };
  if (!player.active) throw new RoomError(409, "you've left this room; join again first");
  const isHost = room.host === player.id;
  const phase = phaseOf(room);
  const game = room.game;
  const agent = game?.agents.get(player.id);

  if (body.type === "me") {
    return { room: await assemble(room, now, presence(room, stored.seen), stored), now, key: await seatKey(room.salt, player.id), mine: await mineOf(room, player.id) };
  }

  if (body.type === "say") {
    const text = cleanMessage(body.text);
    if (!text) throw new RoomError(400, "say something first");
    if (!game || phase !== "meeting" || !agent || agent.left) throw new RoomError(409, "you can only talk at a meeting");
    let line: ChatLine = { t: now, p: player.id, n: player.name, text, g: game.index, m: game.meeting!.index };
    // The dead talk among themselves.
    if (!agent.alive) {
      const { iv, box } = await seal(await ghostKey(room.salt, game.index), text);
      line = { ...line, text: box, iv };
    }
    await store.push(code, "chat", [JSON.stringify(line)], ROOM_TTL_SECONDS);
    const lines = [...(stored.lists.chat ?? []), JSON.stringify(line)].slice(-CHAT_LINES);
    return { room: await assemble(room, now, presence(room, stored.seen), { ...stored, lists: { chat: lines } }), now, mine: await mineOf(room, player.id) };
  }

  const playing = !!game && phase === "action" && !!agent && !agent.left;
  const g = game?.index ?? 0;
  let event: SusEvent;
  switch (body.type) {
    case "zone":
      if (!playing) throw new RoomError(409, "not now");
      if (!isZone(body.zone)) throw new RoomError(400, "there's nowhere like that on this ship");
      if (body.zone === agent!.zone) return { room: await assemble(room, now, presence(room, stored.seen), stored), now, mine: await mineOf(room, player.id) };
      if (!zoneReachable(agent!, body.zone, now)) throw new RoomError(409, "you can't have got there from where you were");
      event = { k: "zone", t: now, p: player.id, game: g, zone: body.zone };
      break;
    case "vent": {
      const from = typeof body.from === "string" ? VENT_BY_ID.get(body.from) : undefined;
      if (!playing || !agent!.impostor || !agent!.alive) throw new RoomError(409, "you can't do that");
      if (!from || from.zone !== agent!.zone || typeof body.to !== "string" || !from.links.includes(body.to)) throw new RoomError(409, "that vent doesn't go there");
      event = { k: "vent", t: now, p: player.id, game: g, from: from.id, to: body.to };
      break;
    }
    case "begin":
    case "task": {
      const task = typeof body.task === "string" ? TASK_BY_ID.get(body.task) : undefined;
      if (!playing) throw new RoomError(409, "not now");
      if (!task || !agent!.tasks.some((t) => t.id === task.id)) throw new RoomError(400, "that's not one of your tasks");
      if (agent!.zone !== task.room) throw new RoomError(409, `that's done in ${task.room}`);
      event = { k: body.type, t: now, p: player.id, game: g, task: task.id };
      break;
    }
    case "kill": {
      if (!playing || !agent!.impostor || !agent!.alive) throw new RoomError(409, "you can't do that");
      if (now < agent!.killAt) throw new RoomError(409, "not yet");
      const victim = typeof body.target === "string" ? game!.agents.get(body.target) : undefined;
      if (!victim?.alive || victim.impostor || hops(victim.zone, agent!.zone) > 1) throw new RoomError(409, "they're not close enough");
      // Where both last said they were, if they said lately.
      const positions = parsePositions(stored.hashes.pos ?? {}, now);
      const [a, b] = [positions[player.id], positions[victim.id]];
      if (a && b && Math.hypot(a.x - b.x, a.y - b.y) > KILL_REACH) throw new RoomError(409, "they're not close enough");
      event = { k: "kill", t: now, p: player.id, game: g, target: victim.id, x: Number(body.x), y: Number(body.y) };
      break;
    }
    case "report": {
      if (!playing || !agent!.alive) throw new RoomError(409, "you can't do that");
      const found = typeof body.body === "string" ? game!.bodies.find((b) => b.victim === body.body) : undefined;
      if (!found || hops(found.zone, agent!.zone) > 1) throw new RoomError(409, "there's no body here");
      event = { k: "report", t: now, p: player.id, game: g, body: found.victim };
      break;
    }
    case "button":
      if (!playing || !agent!.alive || agent!.zone !== SPOTS.button.zone) throw new RoomError(409, "the button's in the cafeteria");
      if (agent!.buttons <= 0) throw new RoomError(409, "you've used your emergency meeting");
      if (now < game!.buttonAt) throw new RoomError(409, "the button isn't ready yet");
      if (game!.sabotage?.kind === "reactor") throw new RoomError(409, "not while the reactor's melting down!");
      event = { k: "button", t: now, p: player.id, game: g };
      break;
    case "sabotage":
      if (!playing || !agent!.impostor) throw new RoomError(409, "you can't do that");
      if (body.kind !== "lights" && body.kind !== "reactor") throw new RoomError(400, "sabotage what?");
      if (game!.sabotage || now < game!.sabotageAt) throw new RoomError(409, "sabotage isn't ready yet");
      event = { k: "sabotage", t: now, p: player.id, game: g, kind: body.kind };
      break;
    case "fix": {
      const where = game?.sabotage?.kind === "lights" ? SPOTS.lights.zone : "reactor";
      if (!playing || !agent!.alive || !game!.sabotage || game!.sabotage.kind !== body.kind) throw new RoomError(409, "there's nothing to fix");
      if (agent!.zone !== where) throw new RoomError(409, `that's fixed in ${where}`);
      event = { k: "fix", t: now, p: player.id, game: g, kind: game!.sabotage.kind };
      break;
    }
    case "vote": {
      const meeting = game?.meeting;
      if (!game || phase !== "meeting" || !meeting || body.meeting !== meeting.index || !agent?.alive) throw new RoomError(409, "you can't vote now");
      if (now < meeting.votesFrom) throw new RoomError(409, "voting isn't open yet");
      if (agent.vote !== null) throw new RoomError(409, "you've voted");
      if (typeof body.for !== "string" || (body.for !== "skip" && !game.agents.get(body.for)?.alive)) throw new RoomError(400, "vote for someone still here, or skip");
      event = { k: "vote", t: now, p: player.id, game: g, meeting: meeting.index, for: body.for };
      break;
    }
    case "settings": {
      if (!isHost) throw new RoomError(403, "only the host can change the settings");
      if (phase !== "lobby" && phase !== "over") throw new RoomError(409, "wait for this game to finish");
      const settings = cleanSettings(body.settings);
      if (!settings) throw new RoomError(400, "those settings aren't allowed");
      event = { k: "settings", t: now, p: player.id, settings };
      break;
    }
    case "start":
      if (!isHost) throw new RoomError(403, "only the host can start a game");
      if (phase !== "lobby" && phase !== "over") throw new RoomError(409, "a game is already going");
      if ([...room.players.values()].filter((p) => p.active).length < MIN_PLAYERS) throw new RoomError(409, `you need at least ${MIN_PLAYERS} players`);
      event = { k: "start", t: now, p: player.id };
      break;
    case "lobby":
      if (!isHost) throw new RoomError(403, "only the host can end the game");
      if (!game) throw new RoomError(409, "there's no game to end");
      event = { k: "lobby", t: now, p: player.id };
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
  if (LOUD.has(event.k)) await store.swap(code, "pos", VERSION, String(after.view.version), ROOM_TTL_SECONDS);
  return { room: after.view, now, mine: await mineOf(after.room, player.id) };
}

/* ---------------------------------------------------------- positions */

/**
 * Where you are, signed, and where everyone else is: several times a second
 * while a game's on. The answer leaves you out, and anyone who's gone quiet,
 * and says what version the room was at when something last happened that
 * everyone should see.
 */
export async function pos(store: Store, rawCode: unknown, input: unknown, now: number): Promise<{ now: number; pos: Record<string, Position>; version: number }> {
  const code = codeFrom(rawCode);
  const { player, data, mac } = record(input);
  if (!isPlayerId(player) || typeof data !== "string" || data.length > 200 || typeof mac !== "string" || mac.length > 100) throw new RoomError(400, "that request made no sense");
  await verify(store, "sus", code, "pos", player, data, mac);
  let payload: Record<string, unknown>;
  try {
    payload = record(JSON.parse(data));
  } catch {
    throw new RoomError(400, "that request made no sense");
  }
  const { x, y, f, m, v } = payload;
  if (![x, y, f, m, v].every((n) => typeof n === "number" && Number.isFinite(n))) throw new RoomError(400, "that request made no sense");
  const mine: Position = { x: Math.round(x as number), y: Math.round(y as number), f: (f as number) < 0 ? -1 : 1, m: m ? 1 : 0, v: v === 1 || v === 2 ? v : 0, t: now };
  const all = await store.swap(code, "pos", player, JSON.stringify(mine), ROOM_TTL_SECONDS);
  const others = parsePositions(all, now);
  delete others[player];
  return { now, pos: others, version: Number(all[VERSION]) || 0 };
}

/** A player saying they're still here: one hash write, checked by whoever reads it (see geo's ping). */
export async function ping(store: Store, rawCode: unknown, input: unknown, now: number): Promise<{ now: number }> {
  const code = codeFrom(rawCode);
  const { player, token } = record(input);
  if (!isPlayerId(player) || typeof token !== "string" || token.length > 64) {
    throw new RoomError(401, "you're not in this room");
  }
  await store.touch(code, { player, at: now, tok: await hashToken(token) }, ROOM_TTL_SECONDS);
  return { now };
}
