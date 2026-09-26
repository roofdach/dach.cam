import type { PhoneEvent } from "@/lib/phone/room";
import { createRoom } from "@/lib/phone/server/rooms";
import { NOT_SET_UP, failure, fresh, readBody } from "@/lib/rooms/http";
import { storeFromEnv } from "@/lib/rooms/store";

/** Makes a room, with whoever asked as its first player and host. */
export async function POST(request: Request) {
  const store = storeFromEnv<PhoneEvent>("phone");
  if (!store) return fresh({ error: NOT_SET_UP }, 503);
  try {
    return fresh(await createRoom(store, await readBody(request), Date.now()), 201);
  } catch (error) {
    return failure(error);
  }
}
