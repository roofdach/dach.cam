/**
 * Checks for /geo: scoring, the place finder, and multiplayer rooms from the
 * replay rules down to the Redis protocol. `npm run check` runs it after the
 * site's own checks. No network: Google and Upstash are played by fakes that
 * answer the way the real ones are documented to.
 */

import assert from "node:assert/strict";

import { MAP_BOUNDS, MAP_SCALES } from "../lib/geo/data/scales.ts";
import { SEED_COUNTRIES, SEED_COUNTS } from "../lib/geo/data/seeds.ts";
import { COUNTRY_NAMES } from "../lib/geo/countries.ts";
import { dailyDate, dailyNumber, dailySeed, msUntilNextDaily, scoreSquare } from "../lib/geo/daily.ts";
import { WORLD_SCALE_KM, destination, haversineKm, wrapLongitude } from "../lib/geo/earth.ts";
import { LookupError, findPlaces, minimumSeparationKm, townsOnMap, type LookupBatch } from "../lib/geo/finder.ts";
import { MAPS, MAP_BY_ID, PLAYABLE_COUNTRIES, type MapId } from "../lib/geo/maps.ts";
import { cumulate, pickCumulative, randomId, seededRandom } from "../lib/random.ts";
import {
  COUNTDOWN_MS,
  DEFAULT_SETTINGS,
  GONE_MS,
  GRACE_MS,
  MAX_PLAYERS,
  RESULTS_MS,
  cleanName,
  gonePlayers,
  isPlace,
  isSettings,
  phaseOf,
  reduce,
  viewOf,
  type RoomEvent,
  type Settings,
} from "../lib/geo/room.ts";
import { MAX_POINTS, formatDistance, formatPoints, pointsFor } from "../lib/geo/score.ts";
import { CODE_PATTERN, RoomError, act, createRoom, getRoom, ping, type Identity } from "../lib/geo/server/rooms.ts";
import { MAX_PROBES, isProbe, lookUp } from "../lib/geo/server/lookup.ts";
import { MemoryStore, UpstashStore, multiplayerReady, storeFromEnv, upstashFromEnv, type RoomStore } from "../lib/rooms/store.ts";
import { embedUrl, formatCaptureDate, mapsUrl, metadataUrl, readMetadata } from "../lib/geo/streetview.ts";
import type { Place } from "../lib/geo/types.ts";
import { fakeUpstash } from "./fake-upstash.mts";

const results: string[] = [];
async function check(name: string, body: () => void | Promise<void>) {
  await body();
  results.push(name);
}

const near = (actual: number, expected: number, tolerance: number, what = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} ${actual} should be within ${tolerance} of ${expected}`);

/* ------------------------------------------------------------- earth */

await check("distances on the globe come out right", () => {
  near(haversineKm(53.3498, -6.2603, 51.5074, -0.1278), 464, 2, "dublin to london");
  near(haversineKm(0, 0, 0, 180), Math.PI * 6371.0088, 0.001, "half way round");
  near(haversineKm(10, 179.5, 10, -179.5), haversineKm(10, 0, 10, 1), 1e-9, "across the date line");
  assert.equal(haversineKm(48.1, 11.5, 48.1, 11.5), 0);
  for (const [bearing, km] of [
    [0, 5],
    [73, 12.5],
    [190, 30],
    [300, 0.4],
  ]) {
    const [lat, lng] = destination(53.35, -6.26, bearing, km);
    near(haversineKm(53.35, -6.26, lat, lng), km, 1e-6, `walking ${km} km on ${bearing}°`);
  }
  const [, lng] = destination(0, 179.99, 90, 50);
  assert.ok(lng < -179 && lng >= -180, "walking east over the date line wraps");
  assert.equal(wrapLongitude(190), -170);
  assert.equal(wrapLongitude(-180), -180);
  assert.equal(wrapLongitude(180), -180);
  assert.equal(wrapLongitude(-540), -180);
});

/* ------------------------------------------------------------- score */

await check("points fall off like GeoGuessr's", () => {
  assert.equal(pointsFor(0, WORLD_SCALE_KM), MAX_POINTS);
  assert.equal(pointsFor(0.1, WORLD_SCALE_KM), MAX_POINTS, "a hundred metres off is still perfect on the world map");
  assert.equal(pointsFor(WORLD_SCALE_KM / 10, WORLD_SCALE_KM), 1839);
  assert.equal(pointsFor(1000, WORLD_SCALE_KM), 2558);
  assert.equal(pointsFor(5000, WORLD_SCALE_KM), 175);
  assert.equal(pointsFor(20038, WORLD_SCALE_KM), 0, "the far side of the world");
  assert.equal(pointsFor(50, MAP_SCALES.ireland), 1829, "ireland is small, so 50 km costs a lot");
  let last = Infinity;
  for (let km = 0; km < 21000; km += 37) {
    const points = pointsFor(km, WORLD_SCALE_KM);
    assert.ok(points <= last && points >= 0 && Number.isInteger(points));
    last = points;
  }
  for (const bad of [NaN, -1, Infinity]) assert.equal(pointsFor(bad, WORLD_SCALE_KM), 0);
  assert.equal(pointsFor(10, 0), 0);
});

await check("distances and points read naturally", () => {
  assert.equal(formatDistance(0), "0 m");
  assert.equal(formatDistance(0.0424), "42 m");
  assert.equal(formatDistance(0.9994), "999 m");
  assert.equal(formatDistance(0.9996), "1.0 km");
  assert.equal(formatDistance(3.249), "3.2 km");
  assert.equal(formatDistance(9.96), "10 km");
  assert.equal(formatDistance(1284.4), "1,284 km");
  assert.equal(formatPoints(25000), "25,000");
  assert.equal(formatPoints(4999.6), "5,000");
});

/* ------------------------------------------------------------ random */

await check("a seed always gives the same sequence, and a different seed doesn't", () => {
  const take = (seed: string) => Array.from({ length: 50 }, seededRandom(seed));
  assert.deepEqual(take("geo daily 2026-09-25"), take("geo daily 2026-09-25"));
  assert.notDeepEqual(take("geo daily 2026-09-25"), take("geo daily 2026-09-26"));
  const random = seededRandom("spread");
  let sum = 0;
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 100000; i++) {
    const x = random();
    assert.ok(x >= 0 && x < 1);
    sum += x;
    buckets[Math.floor(x * 10)]++;
  }
  near(sum / 100000, 0.5, 0.01, "mean");
  for (const count of buckets) near(count, 10000, 500, "bucket");
});

await check("weighted picks follow the weights", () => {
  const random = seededRandom("weights");
  const cumulative = cumulate([1, 0, 3, 6]);
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 100000; i++) counts[pickCumulative(cumulative, random)]++;
  assert.equal(counts[1], 0, "a zero weight never comes up");
  near(counts[0] / 1000, 10, 1, "10%");
  near(counts[2] / 1000, 30, 1.5, "30%");
  near(counts[3] / 1000, 60, 1.5, "60%");
  assert.equal(pickCumulative(cumulate([5]), random), 0);
});

await check("ids are the length and alphabet asked for", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const code = randomId(4, "BCDFGHJKLMNPQRSTVWXZ");
    assert.match(code, CODE_PATTERN);
    seen.add(code);
  }
  // 2,000 draws from 160,000 codes repeat about a dozen times; a real room retries a taken code.
  assert.ok(seen.size > 1960, "codes rarely repeat");
  assert.match(randomId(24), /^[a-z0-9]{24}$/);
});

/* -------------------------------------------------------------- data */

await check("every map has towns, a name for each country and a scale", () => {
  assert.equal(SEED_COUNTRIES.length, SEED_COUNTS.length);
  assert.deepEqual([...SEED_COUNTRIES].sort(), PLAYABLE_COUNTRIES);
  for (const country of PLAYABLE_COUNTRIES) assert.ok(COUNTRY_NAMES[country], country);
  for (const map of MAPS) {
    assert.ok(MAP_SCALES[map.id] > 100 && MAP_SCALES[map.id] <= WORLD_SCALE_KM, map.id);
    for (const country of Object.keys(map.countries)) {
      assert.ok(SEED_COUNTRIES.includes(country), `${map.id} lists ${country} but there are no towns for it`);
    }
  }
  assert.equal(MAP_SCALES.world, WORLD_SCALE_KM);
  near(MAP_SCALES.ireland, 500, 60, "ireland corner to corner");
  assert.ok(minimumSeparationKm("world") === 300 && minimumSeparationKm("ireland") < 20);
});

await check("each map's towns sit inside its frame, and russia splits at the urals", () => {
  for (const map of MAPS) {
    const towns = townsOnMap(map.id);
    assert.ok(towns.length > 0, map.id);
    const [south, west, north, east] = MAP_BOUNDS[map.id];
    for (const town of towns) {
      assert.ok(town.lat >= south - 1e-9 && town.lat <= north + 1e-9, `${map.id} ${town.country} ${town.lat}`);
      // The frame may run past 180; a town west of the date line counts as the next copy of the world.
      const lng = town.lng < west - 1e-9 ? town.lng + 360 : town.lng;
      assert.ok(lng >= west - 1e-9 && lng <= east + 1e-9, `${map.id} ${town.country} ${town.lng}`);
      assert.ok(town.reach >= 0.5 && town.reach <= 30);
    }
  }
  const europe = townsOnMap("europe").filter((t) => t.country === "RU");
  const asia = townsOnMap("asia").filter((t) => t.country === "RU");
  const world = townsOnMap("world").filter((t) => t.country === "RU");
  assert.ok(europe.length > 50 && asia.length > 50);
  assert.equal(europe.length + asia.length, world.length, "every russian town is on exactly one continent");
  assert.ok(europe.every((t) => t.lng >= 0 && t.lng < 60));
  assert.ok(asia.some((t) => t.lng < -160), "chukotka, across the date line, is asia");
  assert.ok(townsOnMap("ireland").every((t) => t.country === "IE"));
});

/* -------------------------------------------------------- streetview */

await check("google's metadata replies are read carefully", () => {
  const ok = { status: "OK", pano_id: "CZVb-MjJvHh7Lb6EmCMLyw", location: { lat: 53.3, lng: -6.2 }, copyright: "© Google", date: "2019-06" };
  assert.deepEqual(readMetadata(ok), { kind: "found", pano: ok.pano_id, lat: 53.3, lng: -6.2, date: "2019-06" });
  assert.deepEqual(readMetadata({ ...ok, date: "June" }), { kind: "found", pano: ok.pano_id, lat: 53.3, lng: -6.2, date: undefined });
  assert.equal(readMetadata({ ...ok, copyright: "© Some Hiker" }).kind, "empty", "someone's own photo sphere");
  assert.equal(readMetadata({ ...ok, pano_id: "AF1QipNkB3kBkZkQmZ1yF1fUuBrl4LVdGZ5o0Fq0Yx8" }).kind, "empty", "an uploaded panorama");
  assert.equal(readMetadata({ ...ok, location: { lat: "53" } }).kind, "empty");
  assert.equal(readMetadata({ status: "ZERO_RESULTS" }).kind, "empty");
  assert.equal(readMetadata({ status: "NOT_FOUND" }).kind, "empty");
  assert.deepEqual(readMetadata({ status: "REQUEST_DENIED", error_message: "API key not valid" }), {
    kind: "denied",
    reason: "API key not valid",
  });
  assert.equal(readMetadata({ status: "OVER_QUERY_LIMIT" }).kind, "retry");
  assert.equal(readMetadata({ status: "UNKNOWN_ERROR" }).kind, "retry");
  assert.equal(readMetadata("<html>").kind, "retry");
  assert.equal(readMetadata(null).kind, "retry");
});

await check("google urls carry what they need and nothing else", () => {
  const embed = new URL(embedUrl("k&y", { pano: "CZVb-MjJvHh7Lb6EmCMLyw", heading: 211.6 }));
  assert.equal(embed.origin + embed.pathname, "https://www.google.com/maps/embed/v1/streetview");
  assert.equal(embed.searchParams.get("key"), "k&y");
  assert.equal(embed.searchParams.get("pano"), "CZVb-MjJvHh7Lb6EmCMLyw");
  assert.equal(embed.searchParams.get("heading"), "212");
  assert.equal(embed.searchParams.get("fov"), "90");
  assert.ok(!embed.search.includes("location"), "no coordinates in the page");

  const meta = new URL(metadataUrl("key", 53.123456789, -6.5, 1234.4));
  assert.equal(meta.origin + meta.pathname, "https://maps.googleapis.com/maps/api/streetview/metadata");
  assert.equal(meta.searchParams.get("location"), "53.123457,-6.500000");
  assert.equal(meta.searchParams.get("radius"), "1234");
  assert.equal(meta.searchParams.get("source"), "outdoor");

  const maps = new URL(mapsUrl({ pano: "CZVb-MjJvHh7Lb6EmCMLyw", heading: 10, lat: 1.5, lng: 2.5 }));
  assert.equal(maps.searchParams.get("api"), "1");
  assert.equal(maps.searchParams.get("map_action"), "pano");
  assert.equal(maps.searchParams.get("viewpoint"), "1.5,2.5");

  assert.equal(formatCaptureDate("2019-06"), "jun 2019");
  assert.equal(formatCaptureDate("2019-13"), null);
  assert.equal(formatCaptureDate(undefined), null);
});

/* ------------------------------------------------------------ finder */

/** Deterministic noise from a string, for fakes that must answer the same way every time. */
function noise(text: string): number {
  return seededRandom(text)();
}

interface FakeGoogle {
  fetch: typeof fetch;
  calls: string[];
}

/**
 * A pretend metadata endpoint: some spots have nothing, the rest have a
 * panorama a little way off, and replies arrive in a scrambled order.
 */
function fakeGoogle(options: { hitRate?: number; far?: boolean; reply?: (url: URL) => unknown; failures?: number } = {}): FakeGoogle {
  const calls: string[] = [];
  let failures = options.failures ?? 0;
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.href);
    await new Promise((resolve) => setTimeout(resolve, Math.floor(noise(url.href + calls.length) * 5)));
    if (failures > 0) {
      failures--;
      throw new TypeError("network down");
    }
    if (options.reply) return Response.json(options.reply(url));
    const [lat, lng] = url.searchParams.get("location")!.split(",").map(Number);
    const radius = Number(url.searchParams.get("radius"));
    if (noise(url.href) > (options.hitRate ?? 0.5)) return Response.json({ status: "ZERO_RESULTS" });
    const [plat, plng] = options.far ? destination(lat, lng, 45, 200) : destination(lat, lng, noise(`${url.href}b`) * 360, (radius / 1000) * noise(`${url.href}d`));
    const pano = randomIdFrom(url.href);
    return Response.json({ status: "OK", copyright: "© Google", date: "2021-07", location: { lat: plat, lng: plng }, pano_id: pano });
  }) as typeof fetch;
  return { fetch: fakeFetch, calls };
}

/** The browser's lookups, through the server's code, to a pretend Google. */
const via = (google: FakeGoogle, key = "test"): LookupBatch => (probes) => lookUp(probes, key, { fetcher: google.fetch });

function randomIdFrom(text: string): string {
  const random = seededRandom(text);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from({ length: 22 }, () => alphabet[Math.floor(random() * 64)]).join("");
}

await check("the finder returns distinct, spread-out places in the map's countries", async () => {
  for (const map of ["world", "europe", "ireland", "usa", "japan", "asia"] as MapId[]) {
    const google = fakeGoogle();
    const progress: number[] = [];
    const places = await findPlaces({
      map,
      count: 5,
      random: seededRandom(`finder ${map}`),
      lookup: via(google),
      onProgress: (n) => progress.push(n),
    });
    assert.equal(places.length, 5, map);
    assert.deepEqual(progress, [1, 2, 3, 4, 5]);
    assert.equal(new Set(places.map((p) => p.pano)).size, 5);
    for (const place of places) {
      assert.ok(isPlace(place), `${map} ${JSON.stringify(place)}`);
      assert.ok(Object.hasOwn(MAP_BY_ID[map].countries, place.country), `${place.country} is on the ${map} map`);
      assert.equal(place.date, "2021-07");
    }
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        assert.ok(haversineKm(places[i].lat, places[i].lng, places[j].lat, places[j].lng) >= minimumSeparationKm(map));
      }
    }
    for (const call of google.calls) assert.equal(new URL(call).searchParams.get("key"), "test");
  }
});

await check("a seed finds the same places however the replies race", async () => {
  const one = await findPlaces({ map: "world", count: 5, random: seededRandom(dailySeed("2026-10-01")), lookup: via(fakeGoogle()) });
  const two = await findPlaces({ map: "world", count: 5, random: seededRandom(dailySeed("2026-10-01")), lookup: via(fakeGoogle()) });
  assert.deepEqual(one, two);
  const other = await findPlaces({ map: "world", count: 5, random: seededRandom(dailySeed("2026-10-02")), lookup: via(fakeGoogle()) });
  assert.notDeepEqual(one, other);
});

await check("the world map spreads over countries rather than repeating them", async () => {
  const counts = new Map<string, number>();
  let repeats = 0;
  for (let game = 0; game < 40; game++) {
    const places = await findPlaces({ map: "world", count: 5, random: seededRandom(`spread ${game}`), lookup: via(fakeGoogle({ hitRate: 0.9 })) });
    const countries = new Set(places.map((p) => p.country));
    repeats += 5 - countries.size;
    for (const c of countries) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  assert.ok(counts.size >= 40, `40 games visit many countries (${counts.size})`);
  assert.ok(repeats <= 20, `countries seldom repeat within a game (${repeats} repeats)`);
});

await check("a panorama that strays beyond its town's reach is turned down", async () => {
  await assert.rejects(
    findPlaces({ map: "ireland", count: 1, random: seededRandom("far"), lookup: via(fakeGoogle({ far: true })) }),
    (error: unknown) => error instanceof LookupError && !error.denied,
  );
});

await check("a refused key stops the search at once, with Google's reason", async () => {
  const google = fakeGoogle({ reply: () => ({ status: "REQUEST_DENIED", error_message: "This API key is not authorized to use this service or API." }) });
  await assert.rejects(
    findPlaces({ map: "world", count: 5, random: seededRandom("denied"), lookup: via(google) }),
    (error: unknown) => error instanceof LookupError && error.denied && /not authorized/.test(error.message),
  );
  assert.equal(google.calls.length, 8, "one batch, then stop");
});

await check("dropped requests are retried, and a dead network gives up with a message", async () => {
  const flaky = await findPlaces({ map: "japan", count: 2, random: seededRandom("flaky"), lookup: via(fakeGoogle({ failures: 5 })) });
  assert.equal(flaky.length, 2);
  const steady = await findPlaces({ map: "japan", count: 2, random: seededRandom("flaky"), lookup: via(fakeGoogle()) });
  assert.deepEqual(flaky, steady, "retrying doesn't change the outcome");
  await assert.rejects(
    findPlaces({ map: "japan", count: 1, random: seededRandom("dead"), lookup: via(fakeGoogle({ failures: 1000 })) }),
    (error: unknown) => error instanceof LookupError && /couldn't reach/.test(error.message),
  );
});

await check("a search can be called off", async () => {
  const controller = new AbortController();
  const search = findPlaces({ map: "world", count: 5, random: seededRandom("abort"), lookup: via(fakeGoogle({ hitRate: 0 })), signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(search, (error: unknown) => (error as Error).name === "AbortError");
});

await check("the server's street view lookups check what they're asked and answer in order", async () => {
  assert.ok(isProbe([53.3, -6.2, 1000]));
  for (const bad of [[91, 0, 10], [0, 181, 10], [0, 0, 0], [0, 0, 20_000], [0, 0], ["1", 0, 10], null]) {
    assert.ok(!isProbe(bad), JSON.stringify(bad));
  }
  assert.equal(MAX_PROBES, 8);
  const google = fakeGoogle({ hitRate: 0.5 });
  const probes: [number, number, number][] = Array.from({ length: 8 }, (_, i) => [50 + i, 10 + i, 2000]);
  const answers = await lookUp(probes, "server-key", { fetcher: google.fetch, base: "https://example.test/metadata" });
  assert.equal(answers.length, 8);
  assert.ok(answers.some((a) => a.kind === "found") && answers.some((a) => a.kind === "empty"));
  for (const [i, call] of google.calls.entries()) {
    const url = new URL(call);
    assert.equal(url.origin + url.pathname, "https://example.test/metadata");
    assert.equal(url.searchParams.get("key"), "server-key");
    assert.ok(probes.some(([lat, lng]) => url.searchParams.get("location") === `${lat.toFixed(6)},${lng.toFixed(6)}`), `call ${i}`);
  }
  // In order, whatever order the replies arrived in.
  const again = await lookUp(probes, "server-key", { fetcher: fakeGoogle({ hitRate: 0.5 }).fetch, base: "https://example.test/metadata" });
  assert.deepEqual(again, answers);
  const down = await lookUp(probes.slice(0, 2), "k", { fetcher: fakeGoogle({ failures: 99 }).fetch });
  assert.deepEqual(down.map((a) => a.kind), ["retry", "retry"]);
});

/* ------------------------------------------------------------- daily */

await check("the daily turns over at midnight UTC", () => {
  assert.equal(dailyDate(Date.UTC(2026, 8, 25, 23, 59, 59)), "2026-09-25");
  assert.equal(dailyDate(Date.UTC(2026, 8, 26, 0, 0, 0)), "2026-09-26");
  assert.equal(dailyNumber("2026-09-25"), 1);
  assert.equal(dailyNumber("2026-10-25"), 31);
  assert.equal(dailyNumber("2027-03-29"), 186, "across the clocks changing");
  assert.equal(msUntilNextDaily(Date.UTC(2026, 8, 25, 23, 0, 0)), 3600000);
  assert.equal(dailySeed("2026-09-25"), "geo daily 2026-09-25");
  assert.deepEqual([5000, 4500, 4499, 3000, 1500, 1, 0].map(scoreSquare), ["🟩", "🟩", "🟨", "🟨", "🟧", "🟥", "⬛"]);
});

/* -------------------------------------------------------------- room */

const T0 = 1_800_000_000_000;
const SETTINGS: Settings = { map: "ireland", rounds: 3, time: 60 };
const somePlaces = (n: number, offset = 0): Place[] =>
  Array.from({ length: n }, (_, i) => ({
    lat: 52 + i * 0.5 + offset,
    lng: -8 + i * 0.3,
    pano: randomIdFrom(`pano ${i} ${offset}`),
    heading: 90,
    country: "IE",
    date: "2020-05",
  }));

class Log {
  events: RoomEvent[] = [{ k: "create", t: T0, code: "BCDFG", settings: { ...DEFAULT_SETTINGS } }];
  push(event: RoomEvent) {
    this.events.push(event);
    return this;
  }
  join(p: string, t: number, name = p) {
    return this.push({ k: "join", t, p, name, tok: `hash-${p}` });
  }
  room(now: number) {
    return reduce(this.events, now)!;
  }
}

await check("a room's first arrival hosts, and names that clash get numbered", () => {
  const log = new Log().join("a", T0, "sam").join("b", T0 + 5, "Sam").join("c", T0 + 9, "  kim\u0000  ");
  const room = log.room(T0 + 10);
  assert.equal(room.host, "a");
  assert.equal(phaseOf(room), "lobby");
  const view = viewOf(room, T0 + 10);
  assert.deepEqual(view.players.map((p) => p.name), ["sam", "Sam 2", "kim"]);
  assert.equal(new Set(view.players.map((p) => p.color)).size, 3);
  assert.deepEqual(view.settings, DEFAULT_SETTINGS);
  assert.equal(view.version, 4);
  assert.equal(reduce([], T0), null);
  assert.equal(reduce([{ k: "join", t: T0, p: "a", name: "a", tok: "x" }], T0), null, "a log has to start with a room");
});

await check("only the host can change settings or start, and only with sound places", () => {
  const log = new Log().join("a", T0).join("b", T0 + 1);
  log.push({ k: "settings", t: T0 + 2, p: "b", settings: SETTINGS });
  assert.deepEqual(log.room(T0 + 3).settings, DEFAULT_SETTINGS, "not the host");
  log.push({ k: "settings", t: T0 + 3, p: "a", settings: { ...SETTINGS, rounds: 4 } });
  assert.deepEqual(log.room(T0 + 4).settings, DEFAULT_SETTINGS, "four rounds isn't an option");
  log.push({ k: "settings", t: T0 + 4, p: "a", settings: SETTINGS });
  assert.deepEqual(log.room(T0 + 5).settings, SETTINGS);

  log.push({ k: "start", t: T0 + 5, p: "b", settings: SETTINGS, places: somePlaces(3) });
  assert.equal(log.room(T0 + 6).game, null, "not the host");
  log.push({ k: "start", t: T0 + 6, p: "a", settings: SETTINGS, places: somePlaces(2) });
  assert.equal(log.room(T0 + 7).game, null, "too few places");
  log.push({ k: "start", t: T0 + 7, p: "a", settings: SETTINGS, places: [...somePlaces(2), { ...somePlaces(1)[0], country: "ZZ" }] });
  assert.equal(log.room(T0 + 8).game, null, "a country nobody has heard of");
  log.push({ k: "start", t: T0 + 8, p: "a", settings: SETTINGS, places: somePlaces(3) });
  const room = log.room(T0 + 9);
  assert.equal(phaseOf(room), "countdown");
  assert.equal(room.game!.rounds[0].start, T0 + 8 + COUNTDOWN_MS);
  log.push({ k: "settings", t: T0 + 10, p: "a", settings: DEFAULT_SETTINGS });
  assert.deepEqual(log.room(T0 + 11).settings, SETTINGS, "settings are locked during a game");
});

/** A room of three with a three-round Ireland game about to start. */
function started() {
  const log = new Log().join("a", T0).join("b", T0 + 1).join("c", T0 + 2);
  log.push({ k: "start", t: T0 + 10, p: "a", settings: SETTINGS, places: somePlaces(3) });
  const start = T0 + 10 + COUNTDOWN_MS;
  return { log, start, deadline: start + SETTINGS.time * 1000 };
}

await check("guesses score, stay hidden until the round ends, and the round ends once all are in", () => {
  const { log, start } = started();
  const place = somePlaces(3)[0];
  log.push({ k: "guess", t: start - 1, p: "a", g: 1, r: 0, lat: 52, lng: -8 });
  assert.equal(log.room(start).game!.rounds[0].guesses.size, 0, "too early");
  log.push({ k: "guess", t: start + 1000, p: "a", g: 1, r: 0, lat: place.lat, lng: place.lng });
  log.push({ k: "guess", t: start + 2000, p: "a", g: 1, r: 0, lat: 0, lng: 0 });
  log.push({ k: "guess", t: start + 3000, p: "b", g: 1, r: 0, lat: 53, lng: -7 });
  let room = log.room(start + 4000);
  assert.equal(phaseOf(room), "playing");
  assert.equal(room.game!.rounds[0].guesses.get("a")!.points, MAX_POINTS, "only the first guess counts");
  let view = viewOf(room, start + 4000);
  assert.deepEqual(view.game!.rounds[0].guessed, ["a", "b"]);
  assert.equal(view.game!.rounds[0].guesses, null);
  assert.equal(view.game!.rounds[0].place.lat, undefined, "where it is stays secret");
  assert.deepEqual(view.game!.totals, {});

  log.push({ k: "guess", t: start + 5000, p: "c", g: 1, r: 0, lat: 51.9, lng: -8.5 });
  room = log.room(start + 5000);
  assert.equal(phaseOf(room), "results");
  assert.equal(room.game!.rounds[0].end, start + 5000);
  view = viewOf(room, start + 5000);
  assert.equal(view.game!.rounds[0].place.lat, place.lat);
  assert.equal(view.game!.rounds[0].guesses!.length, 3);
  assert.equal(view.game!.totals.a, MAX_POINTS);
  const b = view.game!.rounds[0].guesses!.find((g) => g.player === "b")!;
  near(b.km, haversineKm(53, -7, place.lat, place.lng), 1e-9);
  assert.equal(b.points, pointsFor(b.km, MAP_SCALES.ireland));
  assert.deepEqual(view.game!.upcoming, { pano: somePlaces(3)[1].pano, heading: 90 });

  log.push({ k: "guess", t: start + 5500, p: "c", g: 1, r: 0, lat: 0, lng: 0 });
  assert.equal(log.room(start + 6000).game!.rounds[0].guesses.get("c")!.lat, 51.9, "no second go after an early finish");
  assert.equal(phaseOf(log.room(start + 5000 + RESULTS_MS - 1)), "results");
  const next = log.room(start + 5000 + RESULTS_MS);
  assert.equal(phaseOf(next), "playing");
  assert.equal(next.game!.current, 1);
  assert.equal(next.game!.rounds[1].start, start + 5000 + RESULTS_MS);
});

await check("a round runs to its deadline without everyone, with a little grace for late guesses", () => {
  const { log, start, deadline } = started();
  log.push({ k: "guess", t: start + 100, p: "a", g: 1, r: 0, lat: 52, lng: -8 });
  assert.equal(phaseOf(log.room(deadline - 1)), "playing");
  assert.equal(phaseOf(log.room(deadline)), "results");
  log.push({ k: "guess", t: deadline + GRACE_MS - 1, p: "b", g: 1, r: 0, lat: 52, lng: -8 });
  log.push({ k: "guess", t: deadline + GRACE_MS + 1, p: "c", g: 1, r: 0, lat: 52, lng: -8 });
  const room = log.room(deadline + 3000);
  assert.ok(room.game!.rounds[0].guesses.has("b"), "just in time");
  assert.ok(!room.game!.rounds[0].guesses.has("c"), "too late");
  assert.equal(room.game!.rounds[0].end, deadline);
  assert.equal(room.game!.rounds[0].early, false);
});

await check("the host can skip results, and the game ends after the last round", () => {
  const { log, start, deadline } = started();
  log.push({ k: "next", t: deadline + 100, p: "b", g: 1, r: 0 });
  assert.equal(log.room(deadline + 200).game!.current, 0, "only the host skips");
  log.push({ k: "next", t: deadline + 300, p: "a", g: 1, r: 1 });
  assert.equal(log.room(deadline + 400).game!.current, 0, "skipping the wrong round does nothing");
  log.push({ k: "next", t: deadline + 500, p: "a", g: 1, r: 0 });
  let room = log.room(deadline + 600);
  assert.equal(room.game!.current, 1);
  assert.equal(room.game!.rounds[1].start, deadline + 500);
  const second = room.game!.rounds[1];
  log.push({ k: "next", t: second.start + 10, p: "a", g: 1, r: 1 });
  assert.equal(log.room(second.start + 20).game!.current, 1, "can't skip a round that's still being played");

  // Nobody guesses; the clock alone carries the game to the end.
  const end = second.deadline + RESULTS_MS + SETTINGS.time * 1000 + RESULTS_MS;
  room = log.room(end - 1);
  assert.equal(phaseOf(room), "results");
  assert.equal(room.game!.current, 2);
  room = log.room(end);
  assert.equal(phaseOf(room), "final");
  assert.equal(viewOf(room, end).game!.phase, "final");
  assert.ok(start < end);

  log.push({ k: "start", t: end + 10, p: "b", settings: SETTINGS, places: somePlaces(3, 1) });
  assert.equal(log.room(end + 20).game!.index, 1, "only the host starts again");
  log.push({ k: "start", t: end + 30, p: "a", settings: SETTINGS, places: somePlaces(3, 1) });
  room = log.room(end + 40);
  assert.equal(room.game!.index, 2);
  assert.equal(phaseOf(room), "countdown");
  log.push({ k: "lobby", t: end + 50, p: "a", g: 2 });
  assert.equal(phaseOf(log.room(end + 60)), "lobby");
});

await check("leaving hands on the host and can finish a round early", () => {
  const { log, start } = started();
  log.push({ k: "guess", t: start + 100, p: "b", g: 1, r: 0, lat: 52, lng: -8 });
  log.push({ k: "guess", t: start + 200, p: "c", g: 1, r: 0, lat: 52, lng: -8 });
  log.push({ k: "leave", t: start + 300, p: "a", why: "left", by: "a" });
  const room = log.room(start + 400);
  assert.equal(room.host, "b");
  assert.equal(phaseOf(room), "results", "the only one left to guess walked out");
  assert.equal(room.game!.rounds[0].end, start + 300);
  const view = viewOf(room, start + 400);
  assert.ok(!view.players.some((p) => p.id === "a"), "gone, with no guesses to show");

  // Coming back with the right secret restores the seat, and the host.
  log.push({ k: "join", t: start + 500, p: "a", name: "a again", tok: "hash-a" });
  log.push({ k: "join", t: start + 600, p: "b", name: "impostor", tok: "wrong" });
  const back = log.room(start + 700);
  assert.equal(back.host, "a");
  assert.equal(back.players.get("a")!.name, "a again");
  assert.equal(back.players.get("b")!.name, "b");
});

await check("only the host kicks, and the kicked stay out", () => {
  const log = new Log().join("a", T0).join("b", T0 + 1).join("c", T0 + 2);
  log.push({ k: "leave", t: T0 + 3, p: "c", why: "kicked", by: "b" });
  assert.ok(log.room(T0 + 4).players.get("c")!.active, "b isn't the host");
  log.push({ k: "leave", t: T0 + 5, p: "a", why: "kicked", by: "a" });
  assert.ok(log.room(T0 + 6).players.get("a")!.active, "the host can't kick themself");
  log.push({ k: "leave", t: T0 + 7, p: "c", why: "kicked", by: "a" });
  log.push({ k: "join", t: T0 + 8, p: "c", name: "c", tok: "hash-c" });
  const room = log.room(T0 + 9);
  assert.equal(room.players.get("c")!.active, false);
  assert.equal(room.players.get("c")!.kicked, true);
});

await check("rooms cap at fifty and let go of the silent", () => {
  const log = new Log();
  for (let i = 0; i < MAX_PLAYERS + 5; i++) log.join(`p${i}`, T0 + i);
  const room = log.room(T0 + 100);
  assert.equal([...room.players.values()].filter((p) => p.active).length, MAX_PLAYERS);
  assert.ok(!room.players.has(`p${MAX_PLAYERS}`));

  const small = new Log().join("a", T0).join("b", T0);
  const seen = { a: T0 + 50_000 };
  assert.deepEqual(gonePlayers(small.room(T0 + GONE_MS), seen, T0 + GONE_MS), []);
  assert.deepEqual(gonePlayers(small.room(T0 + GONE_MS + 1), seen, T0 + GONE_MS + 1), ["b"]);
  const view = viewOf(small.room(T0 + 40_000), T0 + 40_000, seen);
  assert.deepEqual(view.players.map((p) => p.away), [false, true]);
});

await check("a replay copes with clocks that disagree by a few milliseconds", () => {
  const { log, start } = started();
  log.push({ k: "guess", t: start + 5000, p: "a", g: 1, r: 0, lat: 52, lng: -8 });
  log.push({ k: "guess", t: start + 4990, p: "b", g: 1, r: 0, lat: 52, lng: -8 });
  const room = log.room(start + 6000);
  assert.equal(room.game!.rounds[0].guesses.size, 2);
  assert.equal(room.game!.rounds[0].guesses.get("b")!.t, start + 5000, "treated as arriving after the one before");
});

await check("settings, places and names are checked before anything trusts them", () => {
  assert.ok(isSettings({ map: "japan", rounds: 10, time: 300 }));
  for (const bad of [null, {}, { map: "mars", rounds: 5, time: 90 }, { map: "world", rounds: 5, time: 45 }, { map: "world", rounds: "5", time: 90 }]) {
    assert.ok(!isSettings(bad), JSON.stringify(bad));
  }
  const place = somePlaces(1)[0];
  assert.ok(isPlace(place));
  for (const bad of [{ ...place, lat: 91 }, { ...place, heading: 360 }, { ...place, pano: "short" }, { ...place, date: "2020" }, { ...place, lng: NaN }]) {
    assert.ok(!isPlace(bad), JSON.stringify(bad));
  }
  assert.equal(cleanName("  a   b  "), "a b");
  assert.equal(cleanName("‮evil​"), "evil");
  assert.equal(cleanName("abcdefghijklmnopqrstuvwxyz"), "abcdefghijklmnop");
  assert.equal(cleanName("😀".repeat(20)), "😀".repeat(16), "cut by character, not by UTF-16 unit");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanName(42), null);
});

/* ----------------------------------------------------------- service */

/** The API's logic against a store, with a clock the test moves by hand. */
async function playThrough(store: RoomStore<RoomEvent>, clock: { now: number }) {
  const created = await createRoom(store, { name: "host" }, clock.now);
  const code = created.room.code;
  assert.match(code, CODE_PATTERN);
  const host = created.you!;
  assert.equal(created.room.host, host.id);

  const joined = await act(store, code.toLowerCase(), { type: "join", name: "guest" }, (clock.now += 1000));
  const guest = joined.you!;
  assert.deepEqual(joined.room.players.map((p) => p.name), ["host", "guest"]);

  const as = (who: Identity, body: Record<string, unknown>) => act(store, code, { ...body, player: who.id, token: who.token }, clock.now);

  await assert.rejects(as({ ...guest, token: "nope" }, { type: "leave" }), (e: unknown) => e instanceof RoomError && e.status === 401);
  await assert.rejects(as(guest, { type: "start", settings: SETTINGS, places: somePlaces(3) }), (e: unknown) => e instanceof RoomError && e.status === 403);
  await assert.rejects(as(host, { type: "start", settings: SETTINGS, places: somePlaces(2) }), (e: unknown) => e instanceof RoomError && e.status === 400);

  let reply = await as(host, { type: "settings", settings: SETTINGS });
  assert.deepEqual(reply.room.settings, SETTINGS);
  reply = await as(host, { type: "start", settings: SETTINGS, places: somePlaces(3) });
  assert.equal(reply.room.game!.phase, "countdown");
  await assert.rejects(as(guest, { type: "guess", g: 1, r: 0, lat: 52, lng: -8 }), (e: unknown) => e instanceof RoomError && e.status === 409);

  clock.now += COUNTDOWN_MS;
  await as(host, { type: "guess", g: 1, r: 0, lat: 52, lng: -8 });
  await assert.rejects(as(host, { type: "guess", g: 1, r: 0, lat: 52, lng: -8 }), (e: unknown) => e instanceof RoomError && /already/.test(e.message));
  reply = await as(guest, { type: "guess", g: 1, r: 0, lat: 52.1, lng: -8.1 });
  assert.equal(reply.room.game!.phase, "results");
  assert.equal(reply.room.game!.totals[host.id], MAX_POINTS);

  reply = await as(host, { type: "next", g: 1, r: 0 });
  assert.equal(reply.room.game!.phase, "playing");
  assert.equal(reply.room.game!.current, 1);

  // The guest's tab goes quiet (though someone tries to keep them looking alive without their
  // secret); after a while the room lets them go, and the round no longer waits.
  clock.now += 5000;
  assert.deepEqual(await ping(store, code, { player: host.id, token: host.token }, clock.now), { now: clock.now });
  await ping(store, code, { player: guest.id, token: "forged" }, clock.now);
  clock.now += GONE_MS - 4000;
  await ping(store, code, { player: host.id, token: host.token }, clock.now);
  await ping(store, code, { player: guest.id, token: "forged" }, clock.now);
  await assert.rejects(ping(store, code, { player: "<script>", token: "x" }, clock.now), (e: unknown) => e instanceof RoomError && e.status === 401);
  let view = await getRoom(store, code, clock.now);
  assert.equal(view.players.find((p) => p.id === guest.id)?.active, false);
  await as(host, { type: "guess", g: 1, r: 1, lat: 52, lng: -8 });
  view = await getRoom(store, code, clock.now);
  assert.equal(view.game!.phase, "results", "the only one here has guessed");

  // They come back with their secret and are let in again, scores intact.
  reply = await act(store, code, { type: "join", name: "guest", player: guest.id, token: guest.token }, clock.now);
  assert.equal(reply.you!.id, guest.id);
  assert.equal(reply.room.game!.totals[guest.id], pointsFor(haversineKm(52.1, -8.1, 52, -8), MAP_SCALES.ireland));

  reply = await as(host, { type: "kick", target: guest.id });
  assert.equal(reply.room.players.find((p) => p.id === guest.id)?.active, false);
  await assert.rejects(act(store, code, { type: "join", name: "guest", player: guest.id, token: guest.token }, clock.now), (e: unknown) => e instanceof RoomError && e.status === 403);
  const stranger = await act(store, code, { type: "join", name: "guest" }, clock.now);
  assert.notEqual(stranger.you!.id, guest.id, "a new seat, not the kicked one");

  await assert.rejects(getRoom(store, "ZZZZZ", clock.now), (e: unknown) => e instanceof RoomError && e.status === 404);
  await assert.rejects(getRoom(store, "not a code", clock.now), (e: unknown) => e instanceof RoomError && e.status === 404);
  await assert.rejects(createRoom(store, { name: " " }, clock.now), (e: unknown) => e instanceof RoomError && e.status === 400);
  await assert.rejects(act(store, code, "nonsense", clock.now), (e: unknown) => e instanceof RoomError && e.status === 400);
  return code;
}

await check("the multiplayer API plays a game through, in memory", async () => {
  const clock = { now: T0 };
  const store = new MemoryStore<RoomEvent>(() => clock.now);
  const code = await playThrough(store, clock);
  clock.now += 7 * 60 * 60 * 1000;
  await assert.rejects(getRoom(store, code, clock.now), (e: unknown) => e instanceof RoomError && e.status === 404, "rooms expire");
});

await check("a write that races another is read back rather than guessed at", async () => {
  const clock = { now: T0 };
  const inner = new MemoryStore<RoomEvent>(() => clock.now);
  const { room, you } = await createRoom(inner, { name: "a" }, clock.now);
  // Someone else's join lands between this request's read and its write.
  const racing: RoomStore<RoomEvent> = {
    create: inner.create.bind(inner),
    read: inner.read.bind(inner),
    touch: inner.touch.bind(inner),
    push: inner.push.bind(inner),
    slice: inner.slice.bind(inner),
    async append(code, events, ttl, seen) {
      await inner.append(code, [{ k: "join", t: clock.now, p: "sneaky", name: "sneaky", tok: "x" }], ttl);
      return inner.append(code, events, ttl, seen);
    },
  };
  const reply = await act(racing, room.code, { type: "settings", settings: SETTINGS, player: you!.id, token: you!.token }, clock.now);
  assert.deepEqual(reply.room.players.map((p) => p.name), ["a", "sneaky"]);
  assert.deepEqual(reply.room.settings, SETTINGS);
  assert.equal(reply.room.version, 4);
});

await check("the same game plays through Upstash's REST protocol", async () => {
  const upstash = await fakeUpstash("secret");
  try {
    const clock = { now: T0 };
    const code = await playThrough(new UpstashStore<RoomEvent>(`${upstash.url}/`, "secret", "geo"), clock);
    const log = upstash.lists.get(`geo:room:${code}:log`)!;
    assert.ok(log.length > 10 && log.every((line) => JSON.parse(line).t >= T0));
    assert.ok(upstash.hashes.get(`geo:room:${code}:seen`)!.size >= 2);
    for (const key of [`geo:room:${code}`, `geo:room:${code}:log`, `geo:room:${code}:seen`]) {
      assert.equal(upstash.ttls.get(key), 6 * 60 * 60, `${key} expires`);
    }
    assert.ok(upstash.commands.some(([name, , value, nx]) => name === "SET" && value === "1" && nx === "NX"), "codes are claimed atomically");
    await assert.rejects(new UpstashStore<RoomEvent>(upstash.url, "wrong", "geo").read(code), /401/);
  } finally {
    await upstash.close();
  }
});

await check("a room code is only handed out once, even in Redis", async () => {
  const upstash = await fakeUpstash("t");
  try {
    const store = new UpstashStore<RoomEvent>(upstash.url, "t", "geo");
    const events: RoomEvent[] = [{ k: "create", t: T0, code: "BBBBB", settings: DEFAULT_SETTINGS }];
    assert.equal(await store.create("BBBBB", events, { player: "a", at: T0, tok: "x" }, 60), true);
    assert.equal(await store.create("BBBBB", events, { player: "b", at: T0, tok: "y" }, 60), false);
    assert.equal((await store.read("BBBBB"))!.events.length, 1);
    assert.equal(await store.read("CCCCC"), null);
  } finally {
    await upstash.close();
  }
});

await check("multiplayer picks its store from the environment", () => {
  assert.ok(storeFromEnv("geo", { KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t", VERCEL: "1" }) instanceof UpstashStore);
  assert.ok(storeFromEnv("geo", { UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }) instanceof UpstashStore);
  assert.equal(storeFromEnv("geo", { VERCEL: "1" }), null, "memory isn't shared between Vercel functions");
  assert.equal(storeFromEnv("geo", { KV_REST_API_URL: "https://x.upstash.io", VERCEL: "1" }), null, "a URL without a token is no use");
  const local = storeFromEnv("geo", {});
  assert.ok(local instanceof MemoryStore);
  assert.equal(storeFromEnv("geo", {}), local, "one shared store per process and game");
  assert.notEqual(storeFromEnv("draw", {}), local, "games don't share rooms");
  // Pasted from Upstash's .env snippet, quotes and all.
  assert.deepEqual(upstashFromEnv({ UPSTASH_REDIS_REST_URL: ' "https://x.upstash.io" ', UPSTASH_REDIS_REST_TOKEN: "'AX=='\n" }), { url: "https://x.upstash.io", token: "AX==" });
  assert.deepEqual(upstashFromEnv({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" }), { url: "https://x.upstash.io", token: "t" });
  assert.equal(upstashFromEnv({ KV_REST_API_URL: '""', KV_REST_API_TOKEN: "t" }), null, "a pair of quotes is no address");
  assert.equal(multiplayerReady({ UPSTASH_REDIS_REST_URL: "  ", UPSTASH_REDIS_REST_TOKEN: "t", VERCEL: "1" }), false);
});

console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} geo checks passed`);
