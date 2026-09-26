/**
 * Where multiplayer rooms live between requests, for every game on the site.
 * On Vercel every request can land on a different machine, so rooms have to
 * sit in a shared store: Upstash Redis, spoken to over its REST API, which
 * Vercel's Storage tab can set up for free. Anywhere else (`next dev`,
 * `next start`) one process serves everything, so memory will do.
 *
 * A room is a handful of keys under one prefix that expire together, a few
 * hours after anyone last did anything: `GAME:room:CODE` (claims the code),
 * `GAME:room:CODE:log` (a list of JSON events, which the game replays to
 * work out everything else), `GAME:room:CODE:seen` (a hash of player id to
 * when they were last heard from, with the hash of their secret, so a sign of
 * life can be written without reading anything first and checked by whoever
 * reads it), and any side lists a game keeps, like a drawing's strokes.
 */

/** All a store needs to know about an event: what kind, and when. */
export interface StoredEvent {
  k: string;
  t: number;
}

/** A player's sign of life: when, and the hash of their secret to prove it was them. */
export interface Seen {
  player: string;
  at: number;
  tok: string;
}

export interface StoredRoom<E extends StoredEvent> {
  events: E[];
  seen: Record<string, { at: number; tok: string }>;
  /** Side lists asked for along with the room, by name. */
  lists: Record<string, string[]>;
}

/** A side list to read along with a room: from an index on, or the last few when `from` is negative. */
export interface ListRead {
  name: string;
  from: number;
}

export interface RoomStore<E extends StoredEvent> {
  /** Claims a code and writes the first events; false if the code is taken. */
  create(code: string, events: E[], seen: Seen, ttl: number): Promise<boolean>;
  /** The whole log, and any side lists asked for, in one round trip; null when there's no such room. */
  read(code: string, lists?: ListRead[]): Promise<StoredRoom<E> | null>;
  /** Adds events to the end of the log and returns how long the log now is. */
  append(code: string, events: E[], ttl: number, seen?: Seen): Promise<number>;
  /** Notes that a player is still around: a single write, since this happens every twenty seconds per player. */
  touch(code: string, seen: Seen, ttl: number): Promise<void>;
  /** Adds to one of the room's side lists and returns how long it now is. */
  push(code: string, list: string, items: string[], ttl: number): Promise<number>;
  /** A side list from an index on, or the last few when `from` is negative. */
  slice(code: string, list: string, from: number): Promise<string[]>;
}

const keysFor = (namespace: string, code: string) => ({
  claim: `${namespace}:room:${code}`,
  log: `${namespace}:room:${code}:log`,
  seen: `${namespace}:room:${code}:seen`,
  list: (name: string) => `${namespace}:room:${code}:${name}`,
});

function parseEvents<E extends StoredEvent>(raw: unknown): E[] {
  if (!Array.isArray(raw)) return [];
  const events: E[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    try {
      const event = JSON.parse(item) as E;
      if (event && typeof event === "object" && typeof event.k === "string" && typeof event.t === "number") events.push(event);
    } catch {
      // A line that isn't JSON can only be damage; skip it rather than lose the room.
    }
  }
  return events;
}

const packSeen = (seen: Seen) => `${seen.at}:${seen.tok}`;

function unpackSeen(value: unknown): { at: number; tok: string } | null {
  if (typeof value !== "string") return null;
  const split = value.indexOf(":");
  const at = Number(value.slice(0, split));
  return split > 0 && Number.isFinite(at) ? { at, tok: value.slice(split + 1) } : null;
}

const strings = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);

/* ------------------------------------------------------------- upstash */

type Command = (string | number)[];

export class UpstashStore<E extends StoredEvent> implements RoomStore<E> {
  private readonly url: string;
  private readonly token: string;
  private readonly namespace: string;
  private readonly fetcher: typeof fetch;

  constructor(url: string, token: string, namespace: string, fetcher: typeof fetch = fetch) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.namespace = namespace;
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

  async create(code: string, events: E[], seen: Seen, ttl: number) {
    const k = keysFor(this.namespace, code);
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

  async read(code: string, lists: ListRead[] = []): Promise<StoredRoom<E> | null> {
    const k = keysFor(this.namespace, code);
    const [log, seenRaw, ...listsRaw] = await this.pipeline([
      ["LRANGE", k.log, 0, -1],
      ["HGETALL", k.seen],
      ...lists.map(({ name, from }): Command => ["LRANGE", k.list(name), from, -1]),
    ]);
    const events = parseEvents<E>(log);
    if (events.length === 0) return null;
    const seen: StoredRoom<E>["seen"] = {};
    if (Array.isArray(seenRaw)) {
      for (let i = 0; i + 1 < seenRaw.length; i += 2) {
        const entry = unpackSeen(seenRaw[i + 1]);
        if (typeof seenRaw[i] === "string" && entry) seen[seenRaw[i] as string] = entry;
      }
    }
    return { events, seen, lists: Object.fromEntries(lists.map(({ name }, i) => [name, strings(listsRaw[i])])) };
  }

  async append(code: string, events: E[], ttl: number, seen?: Seen) {
    const k = keysFor(this.namespace, code);
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
    const k = keysFor(this.namespace, code);
    // The expiry rides along so a sign of life for a room that has gone doesn't linger.
    await this.pipeline([
      ["HSET", k.seen, seen.player, packSeen(seen)],
      ["EXPIRE", k.seen, ttl],
    ]);
  }

  async push(code: string, list: string, items: string[], ttl: number) {
    const key = keysFor(this.namespace, code).list(list);
    const [length] = await this.pipeline([["RPUSH", key, ...items]]);
    if (!Number.isInteger(Number(length))) throw new Error("Upstash didn't say how long the list is");
    // A new list gets its expiry once, rather than on every push: a drawing is pushed a few times a second.
    if (Number(length) === items.length) await this.pipeline([["EXPIRE", key, ttl]]);
    return Number(length);
  }

  async slice(code: string, list: string, from: number) {
    const [items] = await this.pipeline([["LRANGE", keysFor(this.namespace, code).list(list), from, -1]]);
    return strings(items);
  }
}

/* -------------------------------------------------------------- memory */

interface MemoryRoom {
  log: string[];
  seen: Map<string, string>;
  lists: Map<string, string[]>;
  expires: number;
}

export class MemoryStore<E extends StoredEvent> implements RoomStore<E> {
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

  async create(code: string, events: E[], seen: Seen, ttl: number) {
    if (this.live(code)) return false;
    this.rooms.set(code, {
      // Stored as text, as Redis would, so nothing can share objects with a caller.
      log: events.map((e) => JSON.stringify(e)),
      seen: new Map([[seen.player, packSeen(seen)]]),
      lists: new Map(),
      expires: this.clock() + ttl * 1000,
    });
    return true;
  }

  async read(code: string, lists: ListRead[] = []): Promise<StoredRoom<E> | null> {
    const room = this.live(code);
    if (!room) return null;
    const events = parseEvents<E>(room.log);
    if (!events.length) return null;
    const seen: StoredRoom<E>["seen"] = {};
    for (const [player, value] of room.seen) {
      const entry = unpackSeen(value);
      if (entry) seen[player] = entry;
    }
    return { events, seen, lists: Object.fromEntries(lists.map(({ name, from }) => [name, this.range(room, name, from)])) };
  }

  /** LRANGE from..-1: from an index on, or the last few for a negative start. */
  private range(room: MemoryRoom, list: string, from: number): string[] {
    const items = room.lists.get(list) ?? [];
    return items.slice(from < 0 ? Math.max(0, items.length + from) : from);
  }

  private orphan(code: string): MemoryRoom {
    // Like writing to a key that has expired: data with no room around it, which reads as no room.
    const room: MemoryRoom = { log: [], seen: new Map(), lists: new Map(), expires: 0 };
    this.rooms.set(code, room);
    return room;
  }

  async append(code: string, events: E[], ttl: number, seen?: Seen) {
    const room = this.live(code) ?? this.orphan(code);
    room.log.push(...events.map((e) => JSON.stringify(e)));
    if (seen) room.seen.set(seen.player, packSeen(seen));
    room.expires = this.clock() + ttl * 1000;
    return room.log.length;
  }

  async touch(code: string, seen: Seen) {
    // Unlike the log, a sign of life doesn't keep a room alive.
    this.live(code)?.seen.set(seen.player, packSeen(seen));
  }

  async push(code: string, list: string, items: string[], ttl: number) {
    const room = this.live(code) ?? this.orphan(code);
    const existing = room.lists.get(list) ?? [];
    existing.push(...items);
    room.lists.set(list, existing);
    room.expires = Math.max(room.expires, this.clock() + ttl * 1000);
    return existing.length;
  }

  async slice(code: string, list: string, from: number) {
    const room = this.live(code);
    return room ? this.range(room, list, from) : [];
  }
}

/* ----------------------------------------------------------------- env */

const globalMemory = globalThis as typeof globalThis & { __rooms?: Map<string, MemoryStore<StoredEvent>> };

/**
 * A game's store for this deployment, or null when multiplayer can't work
 * here: on Vercel without Upstash, where memory isn't shared between
 * requests. Vercel's Upstash integration names its variables KV_REST_API_*;
 * Upstash's own docs say UPSTASH_REDIS_REST_*. Either works.
 */
export function storeFromEnv<E extends StoredEvent>(
  namespace: string,
  env: Record<string, string | undefined> = process.env,
): RoomStore<E> | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashStore<E>(url, token, namespace);
  if (env.VERCEL) return null;
  const stores = (globalMemory.__rooms ??= new Map());
  if (!stores.has(namespace)) stores.set(namespace, new MemoryStore());
  return stores.get(namespace) as unknown as RoomStore<E>;
}

/** Whether this deployment can host rooms, without creating anything. */
export function multiplayerReady(env: Record<string, string | undefined> = process.env): boolean {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return Boolean(url && token) || !env.VERCEL;
}
