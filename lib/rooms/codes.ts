/**
 * Room codes: four letters, easy to read out across a classroom and type in
 * without a link. No vowels, so a code can't spell anything, and none of the
 * letters that look like numbers. That leaves 160,000 codes, and a code is
 * only taken while its room is open.
 */

import { RoomError } from "./http.ts";

export const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const CODE_LENGTH = 4;
export const CODE_PATTERN = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

/** Letters that can't be in a code, for tidying up what someone types. */
export const NOT_CODE_LETTERS = /[^BCDFGHJKLMNPQRSTVWXZ]/g;

/** A code as typed, uppercased; a 404 if it can't be one. */
export function codeFrom(value: unknown): string {
  const code = typeof value === "string" ? value.toUpperCase() : "";
  if (!CODE_PATTERN.test(code)) throw new RoomError(404, "there's no room with that code");
  return code;
}

/** SHA-256 of a player's secret, which is all a room keeps of it. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tidies a display name, or returns null if nothing is left. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value
    .normalize("NFC")
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const short = Array.from(name).slice(0, 16).join("").trim();
  return short.length > 0 ? short : null;
}
