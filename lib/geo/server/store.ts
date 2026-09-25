/**
 * Where rooms live between requests. On Vercel every request can land on a
 * different machine, so rooms have to sit in a shared store: Upstash Redis,
 * spoken to over its REST API, which Vercel's Storage tab can set up for free.
 * Anywhere else (`next dev`, `next start`) one process serves everything, so
 * memory will do.
 *
 * A room is three keys that expire together, a few hours after anyone last
 * did anything: `geo:room:CODE` (claims the code), `geo:room:CODE:log` (a
 * list of JSON events, see lib/geo/room.ts) and `geo:room:CODE:seen` (a hash
 * of player id to when they were last heard from, with the hash of their
 * secret, so a sign of life can be written without reading anything first
 * and checked by whoever reads it).
 */

import type { RoomEvent } from "../room.ts";

/** A player's sign of life: when, and the hash of their secret to prove it was them. */
export interface Seen {
  player: string;
  at: number;
  tok: string;
}

export interface StoredRoom {
  events: RoomEvent[];
  seen: Record<string, { at: number; tok: string }>;
}

export interface RoomStore {
  /** Claims a code and writes the first events; false if the code is taken. */
  create(code: string, events: RoomEvent[], seen: Seen, ttl: number): Promise<boolean>;
  /** The whole log, or null when there's no such room. */
  read(code: string): Promise<StoredRoom | null>;
  /** Adds events to the end of the log and returns how long the log now is. */
  append(code: string, events: RoomEvent[], ttl: number, seen?: Seen): Promise<number>;
  /** Notes that a player is still around: a single write, since this happens every twenty seconds per player. */
  touch(code: string, seen: Seen, ttl: number): Promise<void>;
}

const packSeen = (seen: Seen) => `${seen.at}:${seen.tok}`;

function unpackSeen(value: unknown): { at: number; tok: string } | null {
  if (typeof value !== "string") return null;
  const split = value.indexOf(":");
  const at = Number(value.slice(0, split));
  return split > 0 && Number.isFinite(at) ? { at, tok: value.slice(split + 1) } : null;
}

const keys = (code: string) => ({ claim: `geo:room:${code}`, log: `geo:room:${code}:log`, seen: `geo:room:${code}:seen` });

function parseEvents(raw: unknown): RoomEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: RoomEvent[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    try {
      const event = JSON.parse(item) as RoomEvent;
      if (event && typeof event === "object" && typeof event.k === "string" && typeof event.t === "number") events.push(event);
    } catch {
      // A line that isn't JSON can only be damage; skip it rather than lose the room.
    }
  }
  return events;
}

/* ------------------------------------------------------------- upstash */

type Command = (string | number)[];

export class UpstashStore implements RoomStore {
  private readonly url: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;

  constructor(url: string, token: string, fetcher: typeof fetch = fetch) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.fetcher = fetcher;
  }

  /** Runs commands in one round trip, in order. Not a transaction: each is atomic on its own. */
  private async pipeline(commands: Command[]): Promise<unknown[]> {
    const response = await this.fetcher(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands.map((command) => command.map(String))),
      cache: "no-store",
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Upstash replied ${response.status} with something that isn't JSON`);
    }
    if (!response.ok || !Array.isArray(body)) {
      const message = (body as { error?: unknown } | null)?.error;
      throw new Error(`Upstash replied ${response.status}: ${typeof message === "string" ? message : "unexpected reply"}`);
    }
    return body.map((entry: { result?: unknown; error?: unknown }) => {
      if (entry && typeof entry.error === "string") throw new Error(`Upstash: ${entry.error}`);
      return entry?.result ?? null;
    });
  }

  async create(code: string, events: RoomEvent[], seen: Seen, ttl: number) {
    const k = keys(code);
    const [claimed] = await this.pipeline([["SET", k.claim, "1", "NX", "EX", ttl]]);
    if (claimed !== "OK") return false;
    await this.pipeline([
      ["DEL", k.log, k.seen],
      ["RPUSH", k.log, ...events.map((e) => JSON.stringify(e))],
      ["HSET", k.seen, seen.player, packSeen(seen)],
      ["EXPIRE", k.log, ttl],
      ["EXPIRE", k.seen, ttl],
    ]);
    return true;
  }

  async read(code: string): Promise<StoredRoom | null> {
    const k = keys(code);
    const [log, seenRaw] = await this.pipeline([
      ["LRANGE", k.log, 0, -1],
      ["HGETALL", k.seen],
    ]);
    const events = parseEvents(log);
    if (events.length === 0) return null;
    const seen: StoredRoom["seen"] = {};
    if (Array.isArray(seenRaw)) {
      for (let i = 0; i + 1 < seenRaw.length; i += 2) {
        const entry = unpackSeen(seenRaw[i + 1]);
        if (typeof seenRaw[i] === "string" && entry) seen[seenRaw[i] as string] = entry;
      }
    }
    return { events, seen };
  }

  async append(code: string, events: RoomEvent[], ttl: number, seen?: Seen) {
    const k = keys(code);
    const results = await this.pipeline([
      ["RPUSH", k.log, ...events.map((e) => JSON.stringify(e))],
      ...(seen ? [["HSET", k.seen, seen.player, packSeen(seen)] as Command] : []),
      ["EXPIRE", k.log, ttl],
      ["EXPIRE", k.seen, ttl],
      ["EXPIRE", k.claim, ttl],
    ]);
    const length = Number(results[0]);
    if (!Number.isInteger(length)) throw new Error("Upstash didn't say how long the log is");
    return length;
  }

  async touch(code: string, seen: Seen, ttl: number) {
    const k = keys(code);
    // The expiry rides along so a sign of life for a room that has gone doesn't linger.
    await this.pipeline([
      ["HSET", k.seen, seen.player, packSeen(seen)],
      ["EXPIRE", k.seen, ttl],
    ]);
  }
}

/* -------------------------------------------------------------- memory */

interface MemoryRoom {
  log: string[];
  seen: Map<string, string>;
  expires: number;
}

export class MemoryStore implements RoomStore {
  private readonly rooms = new Map<string, MemoryRoom>();
  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  private live(code: string): MemoryRoom | undefined {
    const room = this.rooms.get(code);
    if (room && room.expires <= this.clock()) {
      this.rooms.delete(code);
      return undefined;
    }
    return room;
  }

  async create(code: string, events: RoomEvent[], seen: Seen, ttl: number) {
    if (this.live(code)) return false;
    this.rooms.set(code, {
      // Stored as text, as Redis would, so nothing can share objects with a caller.
      log: events.map((e) => JSON.stringify(e)),
      seen: new Map([[seen.player, packSeen(seen)]]),
      expires: this.clock() + ttl * 1000,
    });
    return true;
  }

  async read(code: string): Promise<StoredRoom | null> {
    const room = this.live(code);
    if (!room) return null;
    const events = parseEvents(room.log);
    if (!events.length) return null;
    const seen: StoredRoom["seen"] = {};
    for (const [player, value] of room.seen) {
      const entry = unpackSeen(value);
      if (entry) seen[player] = entry;
    }
    return { events, seen };
  }

  async append(code: string, events: RoomEvent[], ttl: number, seen?: Seen) {
    let room = this.live(code);
    if (!room) {
      // Like RPUSH on a key that has expired: a log with no beginning, which reads as no room.
      room = { log: [], seen: new Map(), expires: 0 };
      this.rooms.set(code, room);
    }
    room.log.push(...events.map((e) => JSON.stringify(e)));
    if (seen) room.seen.set(seen.player, packSeen(seen));
    room.expires = this.clock() + ttl * 1000;
    return room.log.length;
  }

  async touch(code: string, seen: Seen) {
    // Unlike the log, a sign of life doesn't keep a room alive.
    this.live(code)?.seen.set(seen.player, packSeen(seen));
  }
}

/* ----------------------------------------------------------------- env */

const globalMemory = globalThis as typeof globalThis & { __geoRooms?: MemoryStore };

/**
 * The store for this deployment, or null when multiplayer can't work here:
 * on Vercel without Upstash, where memory isn't shared between requests.
 * Vercel's Upstash integration names its variables KV_REST_API_*; Upstash's
 * own docs say UPSTASH_REDIS_REST_*. Either works.
 */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): RoomStore | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashStore(url, token);
  if (env.VERCEL) return null;
  return (globalMemory.__geoRooms ??= new MemoryStore());
}

/** Whether this deployment can host rooms, without creating anything. */
export function multiplayerReady(env: Record<string, string | undefined> = process.env): boolean {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return Boolean(url && token) || !env.VERCEL;
}
