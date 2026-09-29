/**
 * What the among us API does, apart from HTTP. The room is its log (see
 * lib/sus/room.ts) and one side list, `chat`, for what's said at meetings.
 *
 * Nearly everything in a game is secret from someone, but everyone gets the
 * same copy of the room so the CDN can share it (see lib/rooms/http.ts). So
 * each player's own view travels in it sealed, with a key of their own that
 * only they are given (see lib/draw/secret.ts): everyone gets everyone's,
 * and can open only theirs. Every view is padded to the same length, give
 * or take, so nobody can tell an impostor's from its size, and sealed afresh
 * each time, so nobody can tell whose changed when. What the dead say at a
 * meeting is sealed the same way, with a key only the dead are given.
 */

import { randomId } from "../../random.ts";
import { seal } from "../../draw/secret.ts";
import { CODE_ALPHABET, CODE_LENGTH, cleanName, codeFrom, hashToken } from "../../rooms/codes.ts";
import { RoomError, record } from "../../rooms/http.ts";
import type { ListRead, RoomStore, Seen, StoredRoom } from "../../rooms/store.ts";
import {
  DEFAULT_SETTINGS,
  MAX_EVENTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  cleanSettings,
  gonePlayers,
  isRoom,
  phaseOf,
  privateView,
  reduce,
  viewOf,
  type Me,
  type Room,
  type RoomView,
  type SusEvent,
} from "../room.ts";
import { SPOTS, TASK_BY_ID, exitsFrom, ventsFrom } from "../ship.ts";

export const ROOM_TTL_SECONDS = 6 * 60 * 60;
/** How many chat lines a room shows. */
export const CHAT_LINES = 60;
export const MAX_MESSAGE = 120;
/** Every sealed view is padded out to a multiple of this many characters. */
const PAD = 512;

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
  /** The key your view is sealed with: only ever sent to you. */
  key?: string;
  mine?: Mine | null;
}

const base64 = (data: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(data)));
const digest = async (text: string) => base64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** The key a player's own view is sealed with, from the room's secret salt. */
export const seatKey = (salt: string, player: string) => digest(`${salt}:seat:${player}`);
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
  const stored = await store.read(code, [CHAT]);
  const room = stored && reduce(stored.events, now);
  if (!stored || !room) throw new RoomError(404, "there's no room with that code, or it has expired");
  return { stored, room };
}

async function assemble(room: Room, now: number, seen: Record<string, number>, chat: string[]): Promise<SusView> {
  return { ...viewOf(room, now, seen), chat: parseChat(chat), seals: await sealAll(room) };
}

/** Appends and replays again, reading back only if someone else wrote in between. */
async function commit(store: Store, code: string, stored: StoredRoom<SusEvent>, events: SusEvent[], now: number, seen?: Seen) {
  if (stored.events.length + events.length > MAX_EVENTS) throw new RoomError(409, "this room has been going so long it's full; make a new one");
  const length = await store.append(code, events, ROOM_TTL_SECONDS, seen);
  const mine = { ...stored.seen, ...(seen ? { [seen.player]: { at: seen.at, tok: seen.tok } } : {}) };
  const chat = stored.lists.chat ?? [];
  if (length === stored.events.length + events.length) {
    const room = reduce([...stored.events, ...events], now)!;
    return { room, view: await assemble(room, now, presence(room, mine), chat) };
  }
  const fresh = await load(store, code, now);
  return { room: fresh.room, view: await assemble(fresh.room, now, presence(fresh.room, { ...fresh.stored.seen, ...mine }), fresh.stored.lists.chat ?? []) };
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
      return { room: await assemble(room, now, { [you.id]: now }, []), now, you, key: await seatKey(salt, you.id), mine: null };
    }
  }
  throw new RoomError(503, "couldn't find a free room code; try again");
}

export async function getRoom(store: Store, rawCode: unknown, now: number): Promise<SusView> {
  const code = codeFrom(rawCode);
  const { stored, room } = await load(store, code, now);
  const seen = presence(room, stored.seen);
  const gone = gonePlayers(room, seen, now);
  if (gone.length === 0) return assemble(room, now, seen, stored.lists.chat ?? []);
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
  const chat = stored.lists.chat ?? [];

  if (body.type === "me") {
    return { room: await assemble(room, now, presence(room, stored.seen), chat), now, key: await seatKey(room.salt, player.id), mine: await mineOf(room, player.id) };
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
    const lines = [...chat, JSON.stringify(line)].slice(-CHAT_LINES);
    return { room: await assemble(room, now, presence(room, stored.seen), lines), now, mine: await mineOf(room, player.id) };
  }

  const playing = !!game && phase === "action" && !!agent && !agent.left;
  const g = game?.index ?? 0;
  let event: SusEvent;
  switch (body.type) {
    case "move": {
      if (!playing) throw new RoomError(409, "you can't go anywhere right now");
      if (!isRoom(body.to)) throw new RoomError(400, "there's no room like that on this ship");
      const vent = body.vent === true;
      if (now < agent!.moveAt) throw new RoomError(409, "not so fast");
      if (vent && (!agent!.impostor || !agent!.alive || !ventsFrom(agent!.room).includes(body.to))) throw new RoomError(409, "there's no vent to there from here");
      if (!vent && agent!.alive && !exitsFrom(agent!.room).includes(body.to)) throw new RoomError(409, "you can't get there from here");
      event = { k: "move", t: now, p: player.id, game: g, to: body.to, ...(vent ? { vent: true } : {}) };
      break;
    }
    case "begin":
    case "task": {
      const task = typeof body.task === "string" ? TASK_BY_ID.get(body.task) : undefined;
      if (!playing) throw new RoomError(409, "not now");
      if (!task || !agent!.tasks.some((t) => t.id === task.id)) throw new RoomError(400, "that's not one of your tasks");
      if (agent!.room !== task.room) throw new RoomError(409, `that's done in ${task.room}`);
      event = { k: body.type, t: now, p: player.id, game: g, task: task.id };
      break;
    }
    case "kill":
      if (!playing || !agent!.impostor || !agent!.alive) throw new RoomError(409, "you can't do that");
      if (now < agent!.killAt) throw new RoomError(409, "not yet");
      if (typeof body.target !== "string" || game!.agents.get(body.target)?.room !== agent!.room || !game!.agents.get(body.target)?.alive) throw new RoomError(409, "they're not here any more");
      event = { k: "kill", t: now, p: player.id, game: g, target: body.target };
      break;
    case "report":
      if (!playing || !agent!.alive) throw new RoomError(409, "you can't do that");
      if (typeof body.body !== "string" || !game!.bodies.some((b) => b.victim === body.body && b.room === agent!.room)) throw new RoomError(409, "there's no body here");
      event = { k: "report", t: now, p: player.id, game: g, body: body.body };
      break;
    case "button":
      if (!playing || !agent!.alive || agent!.room !== SPOTS.button) throw new RoomError(409, "the button's in the cafeteria");
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
    case "fix":
      if (!playing || !agent!.alive || !game!.sabotage || game!.sabotage.kind !== body.kind) throw new RoomError(409, "there's nothing to fix");
      if (agent!.room !== SPOTS[game!.sabotage.kind]) throw new RoomError(409, `that's fixed in ${SPOTS[game!.sabotage.kind]}`);
      event = { k: "fix", t: now, p: player.id, game: g, kind: game!.sabotage.kind };
      break;
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
  return { room: after.view, now, mine: await mineOf(after.room, player.id) };
}

/** A player saying they're still here: one hash write, checked by whoever reads it (see geo's ping). */
export async function ping(store: Store, rawCode: unknown, input: unknown, now: number): Promise<{ now: number }> {
  const code = codeFrom(rawCode);
  const { player, token } = record(input);
  if (typeof player !== "string" || !/^[a-z0-9]{1,24}$/.test(player) || typeof token !== "string" || token.length > 64) {
    throw new RoomError(401, "you're not in this room");
  }
  await store.touch(code, { player, at: now, tok: await hashToken(token) }, ROOM_TTL_SECONDS);
  return { now };
}
