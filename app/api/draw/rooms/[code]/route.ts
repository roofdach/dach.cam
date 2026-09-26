import type { DrawEvent } from "@/lib/draw/room";
import { act, draw, getRoom, parseInkQuery, ping } from "@/lib/draw/server/rooms";
import { NOT_SET_UP, failure, fresh, readBody, shared } from "@/lib/rooms/http";
import { storeFromEnv } from "@/lib/rooms/store";

/**
 * The room as everyone in it sees it, with the chat, and with `?ink=TURN.FROM`
 * the drawing from that batch on. It's the same for everyone who asks the same
 * question, so Vercel's CDN may hand out one copy for up to a second (see
 * lib/rooms/http.ts); players ask for the drawing from a round number of
 * batches so their questions match.
 */
export async function GET(request: Request, context: RouteContext<"/api/draw/rooms/[code]">) {
  const store = storeFromEnv<DrawEvent>("draw");
  if (!store) return fresh({ error: NOT_SET_UP }, 503);
  try {
    const ink = parseInkQuery(new URL(request.url).searchParams.get("ink"));
    return shared(await getRoom(store, (await context.params).code, Date.now(), ink));
  } catch (error) {
    return failure(error);
  }
}

/** Anything a player does: join, chat and guess, draw, pick a word, change the settings, start, leave, or just say they're still here. */
export async function POST(request: Request, context: RouteContext<"/api/draw/rooms/[code]">) {
  const store = storeFromEnv<DrawEvent>("draw");
  if (!store) return fresh({ error: NOT_SET_UP }, 503);
  try {
    const { code } = await context.params;
    const body = await readBody(request);
    const type = typeof body === "object" && body !== null ? (body as { type?: unknown }).type : undefined;
    const handler = type === "ping" ? ping : type === "ink" ? draw : act;
    return fresh(await handler(store, code, body, Date.now()));
  } catch (error) {
    return failure(error);
  }
}
