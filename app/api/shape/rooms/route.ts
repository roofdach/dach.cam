import type { ShapeEvent } from "@/lib/shape/room";
import { createRoom } from "@/lib/shape/server/rooms";
import { NOT_SET_UP, failure, fresh, readBody } from "@/lib/rooms/http";
import { storeFromEnv } from "@/lib/rooms/store";

/** Makes a room, with whoever asked as its first player and host. */
export async function POST(request: Request) {
  const store = storeFromEnv<ShapeEvent>("shape");
  if (!store) return fresh({ error: NOT_SET_UP }, 503);
  try {
    return fresh(await createRoom(store, await readBody(request), Date.now()), 201);
  } catch (error) {
    return failure(error);
  }
}
