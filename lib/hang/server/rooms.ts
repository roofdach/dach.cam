/** What hangman's API does, apart from HTTP. The whole room is its log (see lib/hang/room.ts). */

import { randomId } from "../../random.ts";
import { CODE_ALPHABET, CODE_LENGTH, cleanName, codeFrom, hashToken } from "../../rooms/codes.ts";
import { RoomError, record } from "../../rooms/http.ts";
import type { RoomStore, Seen, StoredRoom } from "../../rooms/store.ts";
import {
  DEFAULT_SETTINGS,
  MAX_EVENTS,
  MAX_PLAYERS,
  MIN_TURNS_PLAYERS,
  cleanSettings,
  gonePlayers,
  phaseOf,
  privateView,
  reduce,
  roundOf,
  viewOf,
  type HangEvent,
  type Mine,
  type Room,
  type RoomView,
} from "../room.ts";
import { LIVES, cleanGuess, lettersOf } from "../words.ts";

export const ROOM_TTL_SECONDS = 6 * 60 * 60;

type Store = RoomStore<HangEvent>;

export interface Identity {
  id: string;
  token: string;
}

export interface Reply {
  room: RoomView;
  now: number;
  you?: Identity;
  mine?: Mine;
}

function presence(room: Room, seen: StoredRoom<HangEvent>["seen"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(seen)) if (room.players.get(id)?.tok === entry.tok) out[id] = entry.at;
  return out;
}

async function load(store: Store, code: string, now: number) {
  const stored = await store.read(code);
  const room = stored && reduce(stored.events, now);
  if (!stored || !room) throw new RoomError(404, "there's no room with that code, or it has expired");
  return { stored, room };
}

/** Appends and replays again, reading back only if someone else wrote in between. */
async function commit(store: Store, code: string, stored: StoredRoom<HangEvent>, events: HangEvent[], now: number, seen?: Seen) {
  if (stored.events.length + events.length > MAX_EVENTS) throw new RoomError(409, "this room has been going so long it's full; make a new one");
  const length = await store.append(code, events, ROOM_TTL_SECONDS, seen);
  const mine = { ...stored.seen, ...(seen ? { [seen.player]: { at: seen.at, tok: seen.tok } } : {}) };
  if (length === stored.events.length + events.length) {
    const room = reduce([...stored.events, ...events], now)!;
    return { room, view: viewOf(room, now, presence(room, mine)) };
  }
  const fresh = await load(store, code, now);
  return { room: fresh.room, view: viewOf(fresh.room, now, presence(fresh.room, { ...fresh.stored.seen, ...mine })) };
}

export async function createRoom(store: Store, input: unknown, now: number): Promise<Reply> {
  const name = cleanName(record(input).name);
  if (!name) throw new RoomError(400, "pick a name first");
  const you: Identity = { id: randomId(10), token: randomId(24) };
  const tok = await hashToken(you.token);
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomId(CODE_LENGTH, CODE_ALPHABET);
    const events: HangEvent[] = [
      // The salt picks every game's words; it never leaves the server.
      { k: "create", t: now, code, salt: randomId(24), settings: { ...DEFAULT_SETTINGS } },
      { k: "join", t: now, p: you.id, name, tok },
    ];
    if (await store.create(code, events, { player: you.id, at: now, tok }, ROOM_TTL_SECONDS)) {
      const room = reduce(events, now)!;
      return { room: viewOf(room, now, { [you.id]: now }), now, you, mine: privateView(room, you.id) };
    }
  }
  throw new RoomError(503, "couldn't find a free room code; try again");
}

export async function getRoom(store: Store, rawCode: unknown, now: number): Promise<RoomView> {
  const code = codeFrom(rawCode);
  const { stored, room } = await load(store, code, now);
  const seen = presence(room, stored.seen);
  const gone = gonePlayers(room, seen, now);
  if (gone.length === 0) return viewOf(room, now, seen);
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
      return { room: after.view, now, you: { id: known.id, token }, mine: privateView(after.room, known.id) };
    }
    if (active >= MAX_PLAYERS) throw new RoomError(409, "this room is full");
    const you: Identity = { id: randomId(10), token: randomId(24) };
    const tok = await hashToken(you.token);
    const after = await commit(store, code, stored, [{ k: "join", t: now, p: you.id, name, tok }], now, { player: you.id, at: now, tok });
    return { room: after.view, now, you, mine: privateView(after.room, you.id) };
  }

  const player = await identify(room, body);
  const me: Seen = { player: player.id, at: now, tok: player.tok };
  if (!player.active) throw new RoomError(409, "you've left this room; join again first");
  const isHost = room.host === player.id;
  const phase = phaseOf(room);
  const game = room.game;
  const round = roundOf(room);
  const at = game ? game.rounds.length - 1 : -1;

  if (body.type === "me") return { room: viewOf(room, now, presence(room, stored.seen)), now, mine: privateView(room, player.id) };

  let event: HangEvent;
  switch (body.type) {
    case "guess": {
      if (!game || !round || phase !== "playing" || body.game !== game.index || body.round !== at) throw new RoomError(409, "time's up for that one");
      if (round.setter === player.id) throw new RoomError(409, "you picked this one; watch them guess");
      const g = cleanGuess(body.g);
      if (!g) throw new RoomError(400, "guess a letter, or the whole thing");
      const board = round.boards.get(player.id);
      if (board?.solved != null) throw new RoomError(409, "you've already got it");
      if (board && board.misses >= LIVES) throw new RoomError(409, "you've been hanged for this one");
      if (board?.guesses.some((x) => x === g || (g.length > 1 && x.length > 1 && lettersOf(x) === lettersOf(g)))) throw new RoomError(409, "you've already tried that");
      event = { k: "guess", t: now, p: player.id, game: game.index, round: at, g };
      break;
    }
    case "choose":
      if (!game || !round || phase !== "choosing" || round.setter !== player.id || body.game !== game.index || body.round !== at) throw new RoomError(409, "it's not your turn to pick");
      if (!Number.isInteger(body.i) || (body.i as number) < 0 || (body.i as number) > 2) throw new RoomError(400, "pick one of the three words");
      event = { k: "choose", t: now, p: player.id, game: game.index, round: at, i: body.i as number };
      break;
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
      if (room.settings.mode === "turns" && [...room.players.values()].filter((p) => p.active).length < MIN_TURNS_PLAYERS) {
        throw new RoomError(409, "taking turns needs at least two players");
      }
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
  return { room: after.view, now, mine: privateView(after.room, player.id) };
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
