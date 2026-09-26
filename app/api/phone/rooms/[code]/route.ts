import { MAX_DRAWING_BYTES, type PhoneEvent } from "@/lib/phone/room";
import { act, getRoom, parseChainQuery, ping } from "@/lib/phone/server/rooms";
import { NOT_SET_UP, failure, fresh, readBody, shared } from "@/lib/rooms/http";
import { storeFromEnv } from "@/lib/rooms/store";

/**
 * The room as everyone in it sees it, and with `?chain=GAME.CHAIN` one
 * finished chain's work, once the chains are being shown. It's the same for
 * everyone who asks the same question, so Vercel's CDN may hand out one copy
 * for up to a second (see lib/rooms/http.ts).
 */
export async function GET(request: Request, context: RouteContext<"/api/phone/rooms/[code]">) {
  const store = storeFromEnv<PhoneEvent>("phone");
  if (!store) return fresh({ error: NOT_SET_UP }, 503);
  try {
    const chain = parseChainQuery(new URL(request.url).searchParams.get("chain"));
    return shared(await getRoom(store, (await context.params).code, Date.now(), chain));
  } catch (error) {
    return failure(error);
  }
}

/** Anything a player does: join, hand in their writing or drawing, show the next step, change the settings, start, leave, or say they're still here. */
export async function POST(request: Request, context: RouteContext<"/api/phone/rooms/[code]">) {
  const store = storeFromEnv<PhoneEvent>("phone");
  if (!store) return fresh({ error: NOT_SET_UP }, 503);
  try {
    const { code } = await context.params;
    // A drawing is the biggest thing anyone sends, with a little room for the rest of the request.
    const body = await readBody(request, MAX_DRAWING_BYTES + 16 * 1024);
    const isPing = typeof body === "object" && body !== null && (body as { type?: unknown }).type === "ping";
    return fresh(await (isPing ? ping : act)(store, code, body, Date.now()));
  } catch (error) {
    return failure(error);
  }
}
