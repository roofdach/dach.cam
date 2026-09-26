/**
 * Chat only some of the room may read: the drawer, and whoever has guessed
 * the word, talking among themselves while the rest are still guessing.
 * Everyone gets the same copy of the room (so the CDN can share it; see
 * lib/rooms/http.ts), so those lines travel in it sealed, with a key made
 * from the room's secret salt and the turn. The server hands the key only
 * to the people who may read them, and the salt never leaves it, so there's
 * nothing to guess the key from.
 */

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const toBase64 = (data: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(data)));

/** This turn's key, from the room's salt: the same for everyone who's allowed it. */
export async function turnKey(salt: string, turn: number): Promise<string> {
  return toBase64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:chat:${turn}`)));
}

const importKey = (key: string) => crypto.subtle.importKey("raw", fromBase64(key), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function seal(key: string, text: string): Promise<{ iv: string; box: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const box = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(key), new TextEncoder().encode(text));
  return { iv: toBase64(iv), box: toBase64(box) };
}

/** The line, or null if this key doesn't open it. */
export async function unseal(key: string, iv: string, box: string): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await importKey(key), fromBase64(box));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
