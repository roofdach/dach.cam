/**
 * What the telephone game's API does, apart from HTTP. The log (see
 * lib/phone/room.ts) says who handed what in and when; the work itself goes
 * in a list per chain beside it, `chain:GAME.CHAIN`, read back by whoever
 * carries the chain on, and by everyone once the chains are shown.
 */

import { compact } from "../../draw/ink.ts";
import { randomId } from "../../random.ts";
import { CODE_ALPHABET, CODE_LENGTH, cleanName, codeFrom, hashToken } from "../../rooms/codes.ts";
import { RoomError, record } from "../../rooms/http.ts";
import type { ListRead, RoomStore, Seen, StoredRoom } from "../../rooms/store.ts";
import {
  DEFAULT_SETTINGS,
  MAX_DRAWING_BYTES,
  MAX_EVENTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  cleanSettings,
  cleanText,
  gonePlayers,
  holder,
  isDrawing,
  phaseOf,
  reduce,
  taskOf,
  viewOf,
  workFor,
  type Entry,
  type PhoneEvent,
  type Room,
  type RoomView,
  type Task,
} from "../room.ts";

export const ROOM_TTL_SECONDS = 6 * 60 * 60;

type Store = RoomStore<PhoneEvent>;

export interface Identity {
  id: string;
  token: string;
}

/** What only you may see: your task this step, and the work it carries on from. */
export interface Mine {
  game: number;
  step: number;
  task: Task | null;
  prompt: Entry | null;
  handed: boolean;
}

/** One finished chain's work, for showing. */
export interface ChainSlice {
  game: number;
  chain: number;
  entries: Entry[];
}

export interface PhoneView extends RoomView {
  chain: ChainSlice | null;
}

export interface Reply {
  room: PhoneView;
  now: number;
  you?: Identity;
  mine?: Mine;
}

const chainList = (game: number, chain: number) => `chain:${game}.${chain}`;

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (!Number.isInteger(entry.step) || typeof entry.p !== "string") return false;
  return typeof entry.text === "string" || isDrawing(entry.ops);
}

function parseEntries(lines: string[]): Entry[] {
  const out: Entry[] = [];
  for (const line of lines) {
    try {
      const entry: unknown = JSON.parse(line);
      if (isEntry(entry)) out.push(entry);
    } catch {
      // Damage; skip it.
    }
  }
  return out;
}

/**
 * A chain's work as the log has it: for each step, what the person who had
 * the chain then handed in, the last copy if a retry sent it twice, and
 * nothing the log doesn't know was handed in.
 */
function tidy(room: Room, game: number, chain: number, entries: Entry[]): Entry[] {
  const g = room.game;
  if (!g || g.index !== game || chain < 0 || chain >= g.order.length) return [];
  const byStep = new Map<number, Entry>();
  for (const entry of entries) if (entry.p === holder(g, chain, entry.step)) byStep.set(entry.step, entry);
  const out: Entry[] = [];
  for (let step = 0; step < g.order.length; step++) {
    const entry = byStep.get(step);
    if (entry && g.handed[step]?.has(entry.p)) out.push(entry);
  }
  return out;
}

function presence(room: Room, seen: StoredRoom<PhoneEvent>["seen"]): Record<string, number> {
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

const assemble = (room: Room, now: number, seen: Record<string, number>, chain: ChainSlice | null = null): PhoneView => ({ ...viewOf(room, now, seen), chain });

/** Appends and replays again, reading back only if someone else wrote in between. */
async function commit(store: Store, code: string, stored: StoredRoom<PhoneEvent>, events: PhoneEvent[], now: number, seen?: Seen) {
  if (stored.events.length + events.length > MAX_EVENTS) throw new RoomError(409, "this room has been going so long it's full; make a new one");
  const length = await store.append(code, events, ROOM_TTL_SECONDS, seen);
  const mine = { ...stored.seen, ...(seen ? { [seen.player]: { at: seen.at, tok: seen.tok } } : {}) };
  if (length === stored.events.length + events.length) {
    const room = reduce([...stored.events, ...events], now)!;
    return { room, view: assemble(room, now, presence(room, mine)) };
  }
  const fresh = await load(store, code, now);
  return { room: fresh.room, view: assemble(fresh.room, now, presence(fresh.room, { ...fresh.stored.seen, ...mine })) };
}

export async function createRoom(store: Store, input: unknown, now: number): Promise<Reply> {
  const name = cleanName(record(input).name);
  if (!name) throw new RoomError(400, "pick a name first");
  const you: Identity = { id: randomId(10), token: randomId(24) };
  const tok = await hashToken(you.token);
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomId(CODE_LENGTH, CODE_ALPHABET);
    const events: PhoneEvent[] = [
      { k: "create", t: now, code, settings: { ...DEFAULT_SETTINGS } },
      { k: "join", t: now, p: you.id, name, tok },
    ];
    if (await store.create(code, events, { player: you.id, at: now, tok }, ROOM_TTL_SECONDS)) {
      const room = reduce(events, now)!;
      return { room: assemble(room, now, { [you.id]: now }), now, you };
    }
  }
  throw new RoomError(503, "couldn't find a free room code; try again");
}

/** The room as everyone sees it, and a finished chain's work if asked for once the chains are showing. */
export async function getRoom(store: Store, rawCode: unknown, now: number, chain?: { game: number; chain: number }): Promise<PhoneView> {
  const code = codeFrom(rawCode);
  const { stored, room } = await load(store, code, now, chain ? [{ name: chainList(chain.game, chain.chain), from: 0 }] : []);
  const slice: ChainSlice | null =
    chain && phaseOf(room) === "reveal" && room.game?.index === chain.game
      ? { ...chain, entries: tidy(room, chain.game, chain.chain, parseEntries(stored.lists[chainList(chain.game, chain.chain)] ?? [])) }
      : null;
  const seen = presence(room, stored.seen);
  const gone = gonePlayers(room, seen, now);
  if (gone.length === 0) return assemble(room, now, seen, slice);
  const after = await commit(store, code, stored, gone.map((p) => ({ k: "leave", t: now, p, why: "gone" })), now);
  return { ...after.view, chain: slice };
}

async function identify(room: Room, body: Record<string, unknown>) {
  const player = typeof body.player === "string" ? room.players.get(body.player) : undefined;
  if (!player || typeof body.token !== "string" || (await hashToken(body.token)) !== player.tok) throw new RoomError(401, "you're not in this room");
  if (player.kicked) throw new RoomError(403, "the host removed you from this room");
  return player;
}

/** The work a task carries on from: usually among the last few in its chain, and otherwise somewhere further back. */
async function promptFor(store: Store, code: string, room: Room, task: Task): Promise<Entry | null> {
  const game = room.game!;
  if (task.from === null) return null;
  const list = chainList(game.index, task.chain);
  for (const from of [-3, 0]) {
    const found = tidy(room, game.index, task.chain, parseEntries(await store.slice(code, list, from))).find((e) => e.step === task.from);
    if (found) return found;
  }
  return null;
}

async function mineOf(store: Store, code: string, room: Room, player: string): Promise<Mine | undefined> {
  const game = room.game;
  if (!game || phaseOf(room) !== "playing") return undefined;
  const task = taskOf(game, player);
  return {
    game: game.index,
    step: game.step,
    task,
    prompt: task ? await promptFor(store, code, room, task) : null,
    handed: game.handed[game.step].has(player),
  };
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
      return { room: after.view, now, you: { id: known.id, token } };
    }
    if (active >= MAX_PLAYERS) throw new RoomError(409, "this room is full");
    const you: Identity = { id: randomId(10), token: randomId(24) };
    const tok = await hashToken(you.token);
    const after = await commit(store, code, stored, [{ k: "join", t: now, p: you.id, name, tok }], now, { player: you.id, at: now, tok });
    return { room: after.view, now, you };
  }

  const player = await identify(room, body);
  const me: Seen = { player: player.id, at: now, tok: player.tok };
  if (!player.active) throw new RoomError(409, "you've left this room; join again first");
  const isHost = room.host === player.id;
  const phase = phaseOf(room);
  const game = room.game;

  if (body.type === "me") {
    return { room: assemble(room, now, presence(room, stored.seen)), now, mine: await mineOf(store, code, room, player.id) };
  }

  let event: PhoneEvent;
  switch (body.type) {
    case "submit": {
      if (!game || phase !== "playing" || body.game !== game.index || body.step !== game.step) throw new RoomError(409, "time's up for that step");
      const task = taskOf(game, player.id);
      if (!task) throw new RoomError(409, "you're not in this game; you'll play in the next one");
      if (game.handed[game.step].has(player.id)) throw new RoomError(409, "you've already handed this in");
      const work = workFor(task.kind);
      let entry: Entry;
      if (work === "text") {
        const text = cleanText(body.text);
        if (!text) throw new RoomError(400, "write something first");
        entry = { step: game.step, p: player.id, text };
      } else {
        if (!isDrawing(body.ops)) throw new RoomError(400, "that drawing didn't come through right");
        const ops = compact(body.ops);
        if (ops.length === 0) throw new RoomError(400, "draw something first");
        entry = { step: game.step, p: player.id, ops };
      }
      const line = JSON.stringify(entry);
      if (line.length > MAX_DRAWING_BYTES) throw new RoomError(413, "that drawing is too big to send; try fewer tiny strokes");
      // The work first: if the log write after it fails, a retry replaces it.
      await store.push(code, chainList(game.index, task.chain), [line], ROOM_TTL_SECONDS);
      event = { k: "submit", t: now, p: player.id, game: game.index, step: game.step, work };
      break;
    }
    case "show":
      if (!isHost) throw new RoomError(403, "only the host shows the chains");
      if (!game || phase !== "reveal" || body.game !== game.index || body.n !== game.shown + 1) throw new RoomError(409, "that's already showing");
      event = { k: "show", t: now, p: player.id, game: game.index, n: body.n as number };
      break;
    case "settings": {
      if (!isHost) throw new RoomError(403, "only the host can change the settings");
      if (phase === "playing") throw new RoomError(409, "wait for this game to finish");
      const settings = cleanSettings(body.settings);
      if (!settings) throw new RoomError(400, "those settings aren't allowed");
      event = { k: "settings", t: now, p: player.id, settings };
      break;
    }
    case "start":
      if (!isHost) throw new RoomError(403, "only the host can start a game");
      if (phase === "playing") throw new RoomError(409, "a game is already going");
      if ([...room.players.values()].filter((p) => p.active).length < MIN_PLAYERS) throw new RoomError(409, "you need at least two players");
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
  return { room: after.view, now, mine: await mineOf(store, code, after.room, player.id) };
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

/** Reads `?chain=GAME.CHAIN`. */
export function parseChainQuery(value: string | null): { game: number; chain: number } | undefined {
  const match = value && /^(\d{1,6})\.(\d{1,2})$/.exec(value);
  if (!match) return undefined;
  return { game: Number(match[1]), chain: Number(match[2]) };
}
