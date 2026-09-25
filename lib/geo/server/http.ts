import { RoomError } from "./rooms.ts";

/** Requests are a few hundred bytes; a start with ten places is under 2 KB. */
const MAX_BODY = 16 * 1024;

export async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new RoomError(413, "that request was too big");
  try {
    return JSON.parse(text);
  } catch {
    throw new RoomError(400, "that request made no sense");
  }
}

/** Replies that must never be reused, by a browser or a CDN. */
export function fresh(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function failure(error: unknown): Response {
  if (error instanceof RoomError) return fresh({ error: error.message }, error.status);
  console.error("[geo]", error);
  return fresh({ error: "something went wrong on our side; try again" }, 500);
}

export const NOT_SET_UP = "multiplayer isn't set up on this site yet";
