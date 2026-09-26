/** A failure with an HTTP status and a message fit to show a player. */
export class RoomError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RoomError";
    this.status = status;
  }
}

/** Requests are a few hundred bytes; the biggest are a drawing's strokes and a start with ten places. */
const MAX_BODY = 32 * 1024;

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

/**
 * Replies every player in a room gets the same copy of, which Vercel's CDN may
 * hand out for up to a second so a room costs about one function call a second
 * however many are polling. Browsers never keep them.
 */
export function shared(body: unknown): Response {
  return Response.json(body, { headers: { "Cache-Control": "no-store", "Vercel-CDN-Cache-Control": "max-age=1" } });
}

export function failure(error: unknown): Response {
  if (error instanceof RoomError) return fresh({ error: error.message }, error.status);
  console.error("[rooms]", error);
  return fresh({ error: "something went wrong on our side; try again" }, 500);
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoomError(400, "that request made no sense");
  return value as Record<string, unknown>;
}

export const NOT_SET_UP = "multiplayer isn't set up on this site yet";
