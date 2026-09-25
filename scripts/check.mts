/**
 * One runnable check for the logic behind the page. No framework:
 * `npm run check` either prints a list of ticks or throws.
 *
 * Anything that needs a DOM or a network is left to the browser; what is here
 * is the part that would be silently wrong.
 */

import assert from "node:assert/strict";

import { ActivityType, type LanyardActivity, type LanyardData, type LanyardSpotify } from "../lib/lanyard/types.ts";
import { describePresence, FALLBACK_PRESENCE, formatArtists } from "../lib/lanyard/presence.ts";
import { labelForHost, requestOrigin } from "../lib/origin.ts";

const results: string[] = [];
async function check(name: string, body: () => void | Promise<void>) {
  await body();
  results.push(name);
}

/* --------------------------------------------------------------- presence */

const user: LanyardData = {
  discord_user: { id: "1", username: "someone", avatar: null },
  discord_status: "online",
  activities: [],
  listening_to_spotify: false,
  spotify: null,
};

const song = (title: string, artist: string): Pick<LanyardData, "listening_to_spotify" | "spotify"> => ({
  listening_to_spotify: true,
  spotify: { track_id: null, timestamps: {}, song: title, artist, album: "", album_art_url: null } satisfies LanyardSpotify,
});

const activity = (name: string, type: number, start = 1): LanyardActivity => ({
  id: name,
  name,
  type,
  timestamps: { start },
});

await check("with nothing going on, the status finishes the sentence", () => {
  assert.equal(describePresence(null), FALLBACK_PRESENCE);
  assert.equal(describePresence(user).phrase, "around");
  assert.equal(describePresence({ ...user, discord_status: "dnd" }).phrase, "heads down");
  assert.equal(describePresence({ ...user, discord_status: "idle" }), FALLBACK_PRESENCE);
  assert.equal(describePresence({ ...user, discord_status: "offline" }), FALLBACK_PRESENCE);
});

await check("music and games are described, together when both are on", () => {
  assert.equal(describePresence({ ...user, ...song("halo", "beyoncé") }).phrase, "listening to halo by beyoncé");
  assert.equal(describePresence({ ...user, activities: [activity("minecraft", ActivityType.Playing)] }).phrase, "playing minecraft");
  assert.equal(describePresence({ ...user, activities: [activity("a film", ActivityType.Watching)] }).phrase, "watching a film");
  assert.equal(
    describePresence({ ...user, ...song("halo", "beyoncé"), activities: [activity("minecraft", ActivityType.Playing)] }).phrase,
    "playing minecraft and listening to halo by beyoncé",
  );
});

await check("custom statuses and spotify's own activity are not things you're doing", () => {
  const noise = [activity("hello", ActivityType.Custom), activity("Spotify", ActivityType.Listening)];
  assert.equal(describePresence({ ...user, activities: noise }).phrase, "around");
});

await check("the most recently started activity wins", () => {
  const activities = [activity("chess", ActivityType.Playing, 100), activity("minecraft", ActivityType.Playing, 200)];
  assert.equal(describePresence({ ...user, activities }).phrase, "playing minecraft");
});

await check("a long phrase gives up detail rather than running on", () => {
  const long = "a".repeat(80);
  assert.equal(describePresence({ ...user, ...song(long, "someone") }).phrase, `listening to ${long}`);
  assert.equal(describePresence({ ...user, ...song("a".repeat(120), "someone") }).phrase, "listening to music");
  assert.equal(
    describePresence({ ...user, ...song(long, "someone"), activities: [activity("minecraft", ActivityType.Playing)] }).phrase,
    "playing minecraft with music on",
  );
});

await check("the key changes exactly when the words do", () => {
  const a = describePresence({ ...user, ...song("halo", "beyoncé") });
  const b = describePresence({ ...user, ...song("halo", "beyoncé") });
  const c = describePresence({ ...user, ...song("crazy in love", "beyoncé") });
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
});

await check("artists read the way a person would list them", () => {
  assert.equal(formatArtists("beyoncé"), "beyoncé");
  assert.equal(formatArtists("beyoncé; jay-z"), "beyoncé and jay-z");
  assert.equal(formatArtists("a; b; c"), "a");
  assert.equal(formatArtists(" a ;  "), "a");
});

/* ----------------------------------------------------------------- domain */

await check("a host becomes the name a reader would recognise", () => {
  assert.equal(labelForHost("dach.cam", "fallback"), "dach.cam");
  assert.equal(labelForHost("www.dachh.cc:3000", "fallback"), "dachh.cc");
  assert.equal(labelForHost("DACH.CAM", "fallback"), "dach.cam");
  assert.equal(labelForHost("localhost:3100", "fallback"), "fallback");
  assert.equal(labelForHost(null, "fallback"), "fallback");
  assert.equal(labelForHost("evil<script>", "fallback"), "fallback");
});

await check("the origin follows the proxy, not the socket", () => {
  const of = (entries: Record<string, string>) => requestOrigin(new Headers(entries), "https://fallback.example");
  assert.equal(of({ host: "dach.cam" }), "https://dach.cam");
  assert.equal(of({ host: "internal:3000", "x-forwarded-host": "dachh.cc", "x-forwarded-proto": "https" }), "https://dachh.cc");
  assert.equal(of({ host: "localhost:3000" }), "http://localhost:3000");
  assert.equal(of({}), "https://fallback.example");
  assert.equal(of({ host: "not a host" }), "https://fallback.example");
});

console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} checks passed`);
