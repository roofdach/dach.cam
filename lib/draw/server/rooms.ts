/**
 * What the drawing game's API does, apart from HTTP. A room's log holds only
 * what changes the game (see lib/draw/room.ts); two side lists hold the rest:
 * `chat`, every message that wasn't a correct guess, and `ink:TURN`, each
 * turn's drawing, a few batches of strokes a second.
 */

import { randomId } from "../../random.ts";
import { CODE_ALPHABET, CODE_LENGTH, cleanName, codeFrom, hashToken } from "../../rooms/codes.ts";
import { RoomError, record } from "../../rooms/http.ts";
import type { ListRead, RoomStore, Seen, StoredRoom } from "../../rooms/store.ts";
import { MAX_BATCHES_PER_TURN, isBatch, type Op } from "../ink.ts";
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
  type DrawEvent,
  type Room,
  type RoomView,
} from "../room.ts";
import { seal, turnKey } from "../secret.ts";
import { isClose, mentions, sameWord } from "../text.ts";

export const ROOM_TTL_SECONDS = 6 * 60 * 60;
/** How many chat messages a room shows. */
export const CHAT_LINES = 50;
export const MAX_MESSAGE = 100;

type Store = RoomStore<DrawEvent>;

export interface Identity {
  id: string;
  token: string;
}

export interface ChatLine {
  t: number;
  p: string;
  /** The name at the time, in case they've gone by the time it's read. */
  n: string;
  /** What they said, or for a sealed line, what it looks like sealed. */
  text: string;
  /** Sealed lines: the turn whose key opens them (see lib/draw/secret.ts), and the seal's nonce. */
  g?: number;
  iv?: string;
}

export interface InkSlice {
  turn: number;
  from: number;
  batches: Op[][];
}

export interface DrawView extends RoomView {
  chat: ChatLine[];
  ink: InkSlice | null;
}

/** How a message went: a correct guess, one letter off, the word given away, or just chat. */
export type Said = "correct" | "close" | "hidden" | "sent";

/** What only you may see: the words on offer and the word, your own words if you host, and the key to this turn's sealed chat. */
export type Mine = ReturnType<typeof privateView> & { key: string | null };

export interface Reply {
  room: DrawView;
  now: number;
  you?: Identity;
  said?: Said;
  mine?: Mine;
}

/**
 * Whether someone is on the inside of this turn: drawing it, or has guessed
 * it. What they say while the others are still guessing is sealed so only
 * the others on the inside can read it.
 */
function insider(room: Room, player: string) {
  const turn = room.game && !room.game.finished ? room.game.turn : null;
  return turn?.phase === "drawing" && (turn.drawer === player || turn.guessed.has(player)) ? turn : null;
}

async function mineOf(room: Room, player: string): Promise<Mine> {
  const turn = insider(room, player);
  return { ...privateView(room, player), key: turn ? await turnKey(room.salt, turn.id) : null };
}

const inkList = (turn: number) => `ink:${turn}`;

function parseChat(lines: string[]): ChatLine[] {
  const out: ChatLine[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ChatLine;
      const sealed = entry.g === undefined || (Number.isInteger(entry.g) && typeof entry.iv === "string");
      if (typeof entry.t === "number" && typeof entry.p === "string" && typeof entry.n === "string" && typeof entry.text === "string" && sealed) out.push(entry);
    } catch {
      // Damage; skip it.
    }
  }
  return out;
}

function parseInk(lines: string[]): Op[][] {
  const out: Op[][] = [];
  for (const line of lines) {
    try {
      const batch: unknown = JSON.parse(line);
      out.push(isBatch(batch) ? batch : []);
    } catch {
      // Keep the numbering: an empty batch stands in for a damaged one.
      out.push([]);
    }
  }
  return out;
}

/** Tidies a chat message, or null if nothing's left. */
export function cleanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/g, " ").trim();
  const short = Array.from(text).slice(0, MAX_MESSAGE).join("");
  return short.length > 0 ? short : null;
}

function presence(room: Room, seen: StoredRoom<DrawEvent>["seen"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(seen)) if (room.players.get(id)?.tok === entry.tok) out[id] = entry.at;
  return out;
}

async function load(store: Store, code: string, now: number, lists: ListRead[] = []) {
  const stored = await store.read(code, lists);
  const room = stored && reduce(stored.events, now);
  if (!stored || !room) throw new RoomError(404, "there's no room with that code, or it has expired");
  return { stored, room };
}

function assemble(room: Room, now: number, seen: Record<string, number>, chat: string[], ink: InkSlice | null): DrawView {
  return { ...viewOf(room, now, seen), chat: parseChat(chat), ink };
}

/** Appends and replays again, reading back only if someone else wrote in between. */
async function commit(store: Store, code: string, stored: StoredRoom<DrawEvent>, events: DrawEvent[], now: number, seen?: Seen) {
  if (stored.events.length + events.length > MAX_EVENTS) throw new RoomError(409, "this room has been going so long it's full; make a new one");
  const length = await store.append(code, events, ROOM_TTL_SECONDS, seen);
  const mine = { ...stored.seen, ...(seen ? { [seen.player]: { at: seen.at, tok: seen.tok } } : {}) };
  const chat = await store.slice(code, "chat", -CHAT_LINES);
  if (length === stored.events.length + events.length) {
    const room = reduce([...stored.events, ...events], now)!;
    return { room, view: assemble(room, now, presence(room, mine), chat, null) };
  }
  const fresh = await load(store, code, now);
  return { room: fresh.room, view: assemble(fresh.room, now, presence(fresh.room, { ...fresh.stored.seen, ...mine }), chat, null) };
}

export async function createRoom(store: Store, input: unknown, now: number): Promise<Reply> {
  const name = cleanName(record(input).name);
  if (!name) throw new RoomError(400, "pick a name first");
  const you: Identity = { id: randomId(10), token: randomId(24) };
  const tok = await hashToken(you.token);
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomId(CODE_LENGTH, CODE_ALPHABET);
    const events: DrawEvent[] = [
      // The salt decides every turn's words and hints; it never leaves the server.
      { k: "create", t: now, code, salt: randomId(24), settings: { ...DEFAULT_SETTINGS } },
      { k: "join", t: now, p: you.id, name, tok },
    ];
    if (await store.create(code, events, { player: you.id, at: now, tok }, ROOM_TTL_SECONDS)) {
      const room = reduce(events, now)!;
      return { room: assemble(room, now, { [you.id]: now }, [], null), now, you };
    }
  }
  throw new RoomError(503, "couldn't find a free room code; try again");
}

/** The room as everyone sees it, with the chat, and the drawing from a batch on if asked for. */
export async function getRoom(store: Store, rawCode: unknown, now: number, ink?: { turn: number; from: number }): Promise<DrawView> {
  const code = codeFrom(rawCode);
  const lists: ListRead[] = [{ name: "chat", from: -CHAT_LINES }];
  if (ink) lists.push({ name: inkList(ink.turn), from: ink.from });
  const { stored, room } = await load(store, code, now, lists);
  const inkSlice = ink ? { turn: ink.turn, from: ink.from, batches: parseInk(stored.lists[inkList(ink.turn)] ?? []) } : null;
  const seen = presence(room, stored.seen);
  const gone = gonePlayers(room, seen, now);
  if (gone.length === 0) return assemble(room, now, seen, stored.lists.chat ?? [], inkSlice);
  const after = await commit(store, code, stored, gone.map((p) => ({ k: "leave", t: now, p, why: "gone" })), now);
  return { ...after.view, ink: inkSlice };
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
      return { room: after.view, now, you: { id: known.id, token }, mine: await mineOf(after.room, known.id) };
    }
    if (active >= MAX_PLAYERS) throw new RoomError(409, "this room is full");
    const you: Identity = { id: randomId(10), token: randomId(24) };
    const tok = await hashToken(you.token);
    const after = await commit(store, code, stored, [{ k: "join", t: now, p: you.id, name, tok }], now, { player: you.id, at: now, tok });
    return { room: after.view, now, you, mine: await mineOf(after.room, you.id) };
  }

  const player = await identify(room, body);
  const me: Seen = { player: player.id, at: now, tok: player.tok };
  if (!player.active) throw new RoomError(409, "you've left this room; join again first");
  const isHost = room.host === player.id;
  const phase = phaseOf(room);
  const game = room.game;
  const turn = game && !game.finished ? game.turn : null;

  if (body.type === "me") {
    const chat = await store.slice(code, "chat", -CHAT_LINES);
    return { room: assemble(room, now, presence(room, stored.seen), chat, null), now, mine: await mineOf(room, player.id) };
  }

  if (body.type === "say") {
    const text = cleanMessage(body.text);
    if (!text) throw new RoomError(400, "say something first");
    let said: Said = "sent";
    // The drawer, and anyone who's guessed it, talk among themselves until the drawing's over.
    const inside = insider(room, player.id);
    if (!inside && turn?.phase === "drawing" && turn.word) {
      if (sameWord(text, turn.word)) said = "correct";
      else if (isClose(text, turn.word)) said = "close";
      else if (mentions(text, turn.word)) said = "hidden";
    }
    if (said === "correct") {
      const after = await commit(store, code, stored, [{ k: "guess", t: now, p: player.id, turn: turn!.id }], now, me);
      return { room: after.view, now, said, mine: await mineOf(after.room, player.id) };
    }
    if (said === "sent") {
      let line: ChatLine = { t: now, p: player.id, n: player.name, text };
      if (inside) {
        const { iv, box } = await seal(await turnKey(room.salt, inside.id), text);
        line = { ...line, text: box, g: inside.id, iv };
      }
      await store.push(code, "chat", [JSON.stringify(line)], ROOM_TTL_SECONDS);
    }
    const chat = await store.slice(code, "chat", -CHAT_LINES);
    return { room: assemble(room, now, presence(room, stored.seen), chat, null), now, said };
  }

  let event: DrawEvent;
  switch (body.type) {
    case "settings": {
      if (!isHost) throw new RoomError(403, "only the host can change the settings");
      if (phase !== "lobby" && phase !== "final") throw new RoomError(409, "wait for this game to finish");
      const settings = cleanSettings(body.settings);
      if (!settings) throw new RoomError(400, "those settings aren't allowed");
      event = { k: "settings", t: now, p: player.id, settings };
      break;
    }
    case "start":
      if (!isHost) throw new RoomError(403, "only the host can start a game");
      if (phase !== "lobby" && phase !== "final") throw new RoomError(409, "a game is already going");
      if ([...room.players.values()].filter((p) => p.active).length < MIN_PLAYERS) throw new RoomError(409, "you need at least two players");
      // Starting again from the final scores goes through the lobby, in one step.
      if (phase === "final") {
        const after = await commit(store, code, stored, [{ k: "lobby", t: now, p: player.id }, { k: "start", t: now, p: player.id }], now, me);
        return { room: after.view, now, mine: await mineOf(after.room, player.id) };
      }
      event = { k: "start", t: now, p: player.id };
      break;
    case "choose":
      if (!turn || turn.phase !== "choosing" || turn.drawer !== player.id || body.turn !== turn.id) throw new RoomError(409, "it's not your turn to choose");
      if (!Number.isInteger(body.i) || (body.i as number) < 0 || (body.i as number) > 2) throw new RoomError(400, "pick one of the three words");
      event = { k: "choose", t: now, p: player.id, turn: turn.id, i: body.i as number };
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

/**
 * Who may draw in which turn, remembered for a few seconds by this server
 * instance, so a drawer's stream of strokes (a few requests a second) doesn't
 * make every request read the whole room first.
 */
const pens = new Map<string, { turn: number; drawer: string; tok: string; until: number }>();

/** A batch of the drawer's strokes. Only the drawer, only while drawing, and only so much per turn. */
export async function draw(store: Store, rawCode: unknown, input: unknown, now: number): Promise<{ count: number }> {
  const code = codeFrom(rawCode);
  const body = record(input);
  const ops = body.ops;
  if (!Number.isInteger(body.turn) || !isBatch(ops)) throw new RoomError(400, "those strokes don't look right");
  const token = typeof body.token === "string" ? body.token : "";
  const tok = await hashToken(token);

  const cached = pens.get(code);
  const trusted = cached && cached.turn === body.turn && cached.drawer === body.player && cached.tok === tok && now < cached.until;
  if (!trusted) {
    const { room } = await load(store, code, now);
    const player = await identify(room, body);
    const turn = room.game && !room.game.finished ? room.game.turn : null;
    if (!turn || turn.id !== body.turn || turn.drawer !== player.id || turn.phase !== "drawing") throw new RoomError(409, "it's not your turn to draw");
    // Trusted for a few seconds, and never past the end of the turn plus a moment for the last strokes in flight.
    pens.set(code, { turn: turn.id, drawer: player.id, tok, until: Math.min(now + 4000, turn.drawEnd! + 1500) });
    if (pens.size > 500) pens.delete(pens.keys().next().value!);
  }
  const count = await store.push(code, inkList(body.turn as number), [JSON.stringify(ops)], ROOM_TTL_SECONDS);
  if (count > MAX_BATCHES_PER_TURN) throw new RoomError(409, "that's a lot of drawing for one turn");
  return { count };
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

/** Reads `?ink=TURN.FROM`. */
export function parseInkQuery(value: string | null): { turn: number; from: number } | undefined {
  const match = value && /^(\d{1,6})\.(\d{1,5})$/.exec(value);
  if (!match) return undefined;
  return { turn: Number(match[1]), from: Number(match[2]) };
}
