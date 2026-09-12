/**
 * The relay behind `together`. One event stream per tab for reading, one POST
 * per change for writing, and a room's operation log held in memory so someone
 * arriving later gets the document as it stands.
 *
 * ponytail: in memory means one server. That is the whole ceiling — behind more
 * than one instance, rooms stop seeing each other and this wants redis or a
 * durable object instead. A shared note on a personal site does not.
 */

import type { Op } from "@/lib/together/doc";
import {
  cleanCursor,
  cleanOps,
  cleanPeer,
  cleanRoomName,
  LIMITS,
  type ClientMessage,
  type Peer,
  type ServerEvent,
} from "@/lib/together/protocol";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Subscriber {
  peer: Peer;
  /** Simulated people this tab is puppeting, cleared when it disconnects. */
  bots: Map<string, Peer>;
  send: (event: ServerEvent) => void;
  close: () => void;
}

interface RoomState {
  ops: Op[];
  /** Op keys already in the log, so a reconnect can resend without it growing. */
  seen: Set<string>;
  title: string;
  subscribers: Map<string, Subscriber>;
  emptyAt: number | null;
}

/** Survives the module reloads that dev mode does on every edit. */
const rooms: Map<string, RoomState> =
  (globalThis as { __togetherRooms?: Map<string, RoomState> }).__togetherRooms ??
  ((globalThis as { __togetherRooms?: Map<string, RoomState> }).__togetherRooms = new Map());

const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

/** Drops rooms nobody has been in for a while. Runs when someone arrives. */
function sweep() {
  const now = Date.now();
  for (const [name, room] of rooms) {
    if (room.emptyAt !== null && now - room.emptyAt > EMPTY_ROOM_TTL_MS) rooms.delete(name);
  }
}

function roomFor(name: string): RoomState | null {
  const existing = rooms.get(name);
  if (existing) return existing;
  sweep();
  if (rooms.size >= LIMITS.rooms) return null;
  const room: RoomState = { ops: [], seen: new Set(), title: "shared note", subscribers: new Map(), emptyAt: Date.now() };
  rooms.set(name, room);
  return room;
}

function broadcast(room: RoomState, event: ServerEvent, exceptId?: string) {
  for (const [id, subscriber] of room.subscribers) {
    if (id === exceptId) continue;
    subscriber.send(event);
  }
}

function everyoneIn(room: RoomState): Peer[] {
  const peers: Peer[] = [];
  for (const subscriber of room.subscribers.values()) {
    peers.push(subscriber.peer);
    peers.push(...subscriber.bots.values());
  }
  return peers;
}

function departAll(room: RoomState, subscriber: Subscriber) {
  for (const botId of subscriber.bots.keys()) broadcast(room, { t: "left", id: botId });
  broadcast(room, { t: "left", id: subscriber.peer.id });
}

const encoder = new TextEncoder();

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = cleanRoomName(url.searchParams.get("room"));
  const peer = cleanPeer({
    id: url.searchParams.get("id"),
    name: url.searchParams.get("name"),
    color: url.searchParams.get("color"),
  });
  if (!peer) return new Response("who are you?", { status: 400 });

  const room = roomFor(name);
  if (!room) return new Response("too many rooms are open right now.", { status: 503 });
  if (room.subscribers.size >= LIMITS.peersPerRoom && !room.subscribers.has(peer.id)) {
    return new Response("that room is full.", { status: 503 });
  }

  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };

      const subscriber: Subscriber = {
        peer,
        bots: new Map(),
        send: (event) => write(`data: ${JSON.stringify(event)}\n\n`),
        close: () => {
          open = false;
          try {
            controller.close();
          } catch {
            // Already gone, which is the outcome we wanted anyway.
          }
        },
      };

      // A reconnect reuses the same id, so retire the previous stream first.
      room.subscribers.get(peer.id)?.close();
      room.subscribers.set(peer.id, subscriber);
      room.emptyAt = null;

      // Tell a proxy not to buffer this, then hand over the room as it stands.
      write(": stream open\n\nretry: 2000\n\n");
      subscriber.send({ t: "welcome", peers: everyoneIn(room), ops: room.ops, title: room.title });
      broadcast(room, { t: "joined", peer }, peer.id);

      const keepalive = setInterval(() => write(": ping\n\n"), 20_000);

      const leave = () => {
        clearInterval(keepalive);
        if (room.subscribers.get(peer.id) !== subscriber) return;
        room.subscribers.delete(peer.id);
        departAll(room, subscriber);
        if (room.subscribers.size === 0) room.emptyAt = Date.now();
        subscriber.close();
      };

      request.signal.addEventListener("abort", leave);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > LIMITS.body) return new Response("that change is too big.", { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("that isn't json.", { status: 400 });
  }

  const envelope = body as { room?: unknown; id?: unknown; message?: unknown };
  const room = rooms.get(cleanRoomName(typeof envelope.room === "string" ? envelope.room : null));
  const id = typeof envelope.id === "string" ? envelope.id : "";
  const subscriber = room?.subscribers.get(id);
  // No stream means nothing to say: reconnect first, then talk.
  if (!room || !subscriber) return new Response("not in that room.", { status: 409 });

  const message = envelope.message as ClientMessage | undefined;
  if (!message || typeof message !== "object") return new Response("no message.", { status: 400 });

  /** A tab may speak as itself or as one of its own simulated people. */
  const maySpeakAs = (from: unknown) =>
    typeof from === "string" && (from === subscriber.peer.id || subscriber.bots.has(from));

  switch (message.t) {
    case "ops": {
      if (!maySpeakAs(message.from)) return new Response("not your name to use.", { status: 403 });
      const ops = cleanOps(message.ops);
      if (!ops) return new Response("those operations don't look right.", { status: 400 });
      // Everyone else already has anything the log has seen, so drop repeats
      // rather than relaying them. This is what makes resending safe.
      const fresh = ops.filter((op) => !room.seen.has(`${op.t}${op.id}`));
      if (!fresh.length) return new Response(null, { status: 204 });
      if (room.ops.length + fresh.length > LIMITS.opsPerRoom) {
        subscriber.send({ t: "full" });
        return new Response("this room has run out of history.", { status: 507 });
      }
      for (const op of fresh) room.seen.add(`${op.t}${op.id}`);
      room.ops.push(...fresh);
      broadcast(room, { t: "ops", from: message.from, ops: fresh }, subscriber.peer.id);
      return new Response(null, { status: 204 });
    }

    case "cursor": {
      if (!maySpeakAs(message.from)) return new Response("not your name to use.", { status: 403 });
      const cursor = cleanCursor(message.cursor);
      if (!cursor) return new Response("that isn't a position.", { status: 400 });
      broadcast(room, { t: "cursor", from: message.from, cursor }, subscriber.peer.id);
      return new Response(null, { status: 204 });
    }

    case "title": {
      if (!maySpeakAs(message.from)) return new Response("not your name to use.", { status: 403 });
      const title = typeof message.title === "string" ? message.title.slice(0, LIMITS.title) : "";
      room.title = title;
      broadcast(room, { t: "title", from: message.from, title }, subscriber.peer.id);
      return new Response(null, { status: 204 });
    }

    case "joined": {
      const bot = cleanPeer(message.peer);
      if (!bot || !bot.simulated) return new Response("only simulated people can be introduced.", { status: 400 });
      if (subscriber.bots.size >= 6) return new Response("that's enough imaginary friends.", { status: 429 });
      subscriber.bots.set(bot.id, bot);
      broadcast(room, { t: "joined", peer: bot }, subscriber.peer.id);
      return new Response(null, { status: 204 });
    }

    case "left": {
      if (typeof message.id !== "string" || !subscriber.bots.has(message.id)) {
        return new Response("not yours to remove.", { status: 403 });
      }
      subscriber.bots.delete(message.id);
      broadcast(room, { t: "left", id: message.id }, subscriber.peer.id);
      return new Response(null, { status: 204 });
    }

    default:
      return new Response("unknown message.", { status: 400 });
  }
}
