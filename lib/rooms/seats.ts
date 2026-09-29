/**
 * Seat keys, for requests that come too often to read a room's log for:
 * where someone's standing in sus, how far someone's got in a race. Each
 * player is given a key of their own when they sit down, made from the
 * room's secret salt, and signs those requests with it; the server checks
 * the signature, which only needs the salt, the first event in the log.
 */

import { RoomError } from "./http.ts";
import type { RoomStore, StoredEvent } from "./store.ts";

const encoder = new TextEncoder();
export const toBase64 = (data: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(data)));
export const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const digest = async (text: string) => toBase64(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

/** The key a player's seat is given, from the room's secret salt. */
export const seatKey = (salt: string, player: string) => digest(`${salt}:seat:${player}`);

/** What a signed request is signed over: its kind, who's sending it, and what it says. */
export const signedText = (type: string, player: string, data: string) => `${type}\n${player}\n${data}`;

/** Signs a request with a player's key; browsers do the same. */
export async function sign(key: string, type: string, player: string, data: string): Promise<string> {
  const hmac = await crypto.subtle.importKey("raw", fromBase64(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64(await crypto.subtle.sign("HMAC", hmac, encoder.encode(signedText(type, player, data))));
}

/**
 * Rooms' salts, which never change, remembered by this server instance so a
 * signed request usually costs nothing to check. A code can be reused once
 * its room has gone, so a signature that doesn't check out asks again.
 */
const salts = new Map<string, string>();

async function saltFor(store: RoomStore<StoredEvent>, game: string, code: string, fresh: boolean): Promise<string> {
  const key = `${game}:${code}`;
  const cached = salts.get(key);
  if (cached && !fresh) return cached;
  const head = (await store.head(code)) as (StoredEvent & { salt?: unknown }) | null;
  if (!head || head.k !== "create" || typeof head.salt !== "string") throw new RoomError(404, "there's no room with that code, or it has expired");
  salts.set(key, head.salt);
  if (salts.size > 1000) salts.delete(salts.keys().next().value!);
  return head.salt;
}

/** Checks a signed request to one of `game`'s rooms, or throws a 401. */
export async function verify<E extends StoredEvent>(store: RoomStore<E>, game: string, code: string, type: string, player: string, data: string, mac: string): Promise<void> {
  let signature: ReturnType<typeof fromBase64>;
  try {
    signature = fromBase64(mac);
  } catch {
    throw new RoomError(401, "that request wasn't signed right");
  }
  for (const fresh of [false, true]) {
    const key = await seatKey(await saltFor(store as unknown as RoomStore<StoredEvent>, game, code, fresh), player);
    const hmac = await crypto.subtle.importKey("raw", fromBase64(key), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (await crypto.subtle.verify("HMAC", hmac, signature, encoder.encode(signedText(type, player, data)))) return;
  }
  throw new RoomError(401, "that request wasn't signed right");
}

export const isPlayerId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{1,24}$/.test(value);
