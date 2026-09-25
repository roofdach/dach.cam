import { act, getRoom, ping } from "@/lib/geo/server/rooms";
import { NOT_SET_UP, failure, fresh, readBody } from "@/lib/geo/server/http";
import { storeFromEnv } from "@/lib/geo/server/store";

/**
 * The room as everyone in it sees it. Every player polls this about once a
 * second, and the reply is the same for all of them, so Vercel's CDN may hand
 * out one copy for up to a second: a class of thirty then costs about one
 * function call a second instead of thirty. Browsers never keep it.
 */
export async function GET(_request: Request, context: RouteContext<"/api/geo/rooms/[code]">) {
  const store = storeFromEnv();
  if (!store) return fresh({ error: NOT_SET_UP }, 503);
  try {
    const room = await getRoom(store, (await context.params).code, Date.now());
    return Response.json(room, {
      headers: { "Cache-Control": "no-store", "Vercel-CDN-Cache-Control": "max-age=1" },
    });
  } catch (error) {
    return failure(error);
  }
}

/** Anything a player does: join, guess, start, skip, leave, or just say they're still here. */
export async function POST(request: Request, context: RouteContext<"/api/geo/rooms/[code]">) {
  const store = storeFromEnv();
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
