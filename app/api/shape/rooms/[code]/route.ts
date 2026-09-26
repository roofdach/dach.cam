import type { ShapeEvent } from "@/lib/shape/room";
import { act, getRoom, ping } from "@/lib/shape/server/rooms";
import { NOT_SET_UP, failure, fresh, readBody, shared } from "@/lib/rooms/http";
import { storeFromEnv } from "@/lib/rooms/store";

/** The room as everyone in it sees it: the same for everyone, so Vercel's CDN may share it for a second (see lib/rooms/http.ts). */
export async function GET(_request: Request, context: RouteContext<"/api/shape/rooms/[code]">) {
  const store = storeFromEnv<ShapeEvent>("shape");
  if (!store) return fresh({ error: NOT_SET_UP }, 503);
  try {
    return shared(await getRoom(store, (await context.params).code, Date.now()));
  } catch (error) {
    return failure(error);
  }
}

/** Anything a player does: join, guess, change the settings, start, leave, or say they're still here. */
export async function POST(request: Request, context: RouteContext<"/api/shape/rooms/[code]">) {
  const store = storeFromEnv<ShapeEvent>("shape");
  if (!store) return fresh({ error: NOT_SET_UP }, 503);
  try {
    const { code } = await context.params;
    const body = await readBody(request);
    const isPing = typeof body === "object" && body !== null && (body as { type?: unknown }).type === "ping";
    return fresh(await (isPing ? ping : act)(store, code, body, Date.now()));
  } catch (error) {
    return failure(error);
  }
}
