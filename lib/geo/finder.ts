/**
 * Picks the places a game visits. Each attempt chooses a country by the
 * map's weights, a town in it by population, then a point somewhere around
 * the town, and asks Google for the nearest panorama. A panorama only counts
 * if it is Google's own, and no further from the town than the town's reach,
 * which keeps it on the same side of every border.
 *
 * Everything random is drawn before any request goes out, and the first good
 * candidate in draw order wins, so a given seed always gives the same places
 * however the requests race. That is what makes the daily the same for
 * everyone.
 */

import { SEED_BYTES, SEED_COUNTRIES, SEED_COUNTS } from "./data/seeds.ts";
import { MAP_SCALES } from "./data/scales.ts";
import { destination, haversineKm } from "./earth.ts";
import { MAP_BY_ID, inBand, type MapId } from "./maps.ts";
import { cumulate, pickCumulative, type Random } from "./random.ts";
import { LookupError } from "./errors.ts";
import type { Metadata } from "./streetview.ts";
import type { Place } from "./types.ts";

interface Town {
  lat: number;
  lng: number;
  weight: number;
  /** How far a round may wander from the town, in km. */
  reach: number;
}

let towns: Map<string, Town[]> | undefined;

function allTowns(): Map<string, Town[]> {
  if (towns) return towns;
  const binary = atob(SEED_BYTES);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);

  towns = new Map();
  let offset = 0;
  SEED_COUNTRIES.forEach((country, i) => {
    const list: Town[] = [];
    for (let n = 0; n < SEED_COUNTS[i]; n++, offset += 6) {
      list.push({
        lat: view.getInt16(offset, true) / 100,
        lng: view.getInt16(offset + 2, true) / 100,
        weight: 10 ** (view.getUint8(offset + 4) / 40),
        reach: view.getUint8(offset + 5) / 4,
      });
    }
    towns!.set(country, list);
  });
  return towns;
}

interface Pool {
  countries: string[];
  weights: number[];
  towns: Town[][];
  cumulative: Float64Array[];
}

const pools = new Map<MapId, Pool>();

function poolFor(id: MapId): Pool {
  const cached = pools.get(id);
  if (cached) return cached;
  const map = MAP_BY_ID[id];
  const pool: Pool = { countries: [], weights: [], towns: [], cumulative: [] };
  for (const [country, weight] of Object.entries(map.countries)) {
    const band = map.longitude?.[country];
    const list = (allTowns().get(country) ?? []).filter((t) => !band || inBand(t.lng, band));
    if (list.length === 0 || !(weight > 0)) continue;
    pool.countries.push(country);
    pool.weights.push(weight);
    pool.towns.push(list);
    pool.cumulative.push(cumulate(list.map((t) => t.weight)));
  }
  pools.set(id, pool);
  return pool;
}

/** Every town a map can start a round from, with its country. */
export function townsOnMap(id: MapId): { country: string; lat: number; lng: number; reach: number }[] {
  const pool = poolFor(id);
  return pool.towns.flatMap((list, i) => list.map((t) => ({ country: pool.countries[i], lat: t.lat, lng: t.lng, reach: t.reach })));
}

/** How close two places in one game may be: a thirtieth of the map, but never more than 300 km. */
export function minimumSeparationKm(map: MapId): number {
  return Math.min(300, MAP_SCALES[map] / 30);
}

interface Candidate {
  country: string;
  town: Town;
  lat: number;
  lng: number;
  radiusKm: number;
  heading: number;
}

function draw(pool: Pool, used: Map<string, number>, random: Random): Candidate {
  // A country already visited this game is a fifth as likely to come up again.
  const weights = pool.weights.map((w, i) => w * 0.2 ** (used.get(pool.countries[i]) ?? 0));
  const c = pickCumulative(cumulate(weights), random);
  const town = pool.towns[c][pickCumulative(pool.cumulative[c], random)];

  // A third of rounds stay in town; the rest head out towards the countryside.
  const urban = random() < 0.35;
  const km = urban
    ? random() * Math.min(1.5, town.reach * 0.5)
    : Math.min(town.reach * 0.8, 1.5 + 6 * -Math.log(1 - random()));
  const [lat, lng] = destination(town.lat, town.lng, random() * 360, km);
  return {
    country: pool.countries[c],
    town,
    lat,
    lng,
    radiusKm: Math.min(urban ? 1 : 5, town.reach - km),
    heading: Math.floor(random() * 360),
  };
}

export { LookupError };

/**
 * Asks about a batch of spots, [lat, lng, radius in metres] each, and
 * answers in the same order. In the browser this goes through the site's own
 * /api/geo/streetview, which holds the Google key.
 */
export type LookupBatch = (probes: [number, number, number][], signal?: AbortSignal) => Promise<Metadata[]>;

export interface FindOptions {
  map: MapId;
  count: number;
  random: Random;
  lookup: LookupBatch;
  signal?: AbortSignal;
  onProgress?: (found: number) => void;
}

/** Candidates asked about at once. */
const BATCH = 8;
/** Batches tried for one place before giving up. */
const MAX_BATCHES = 12;
/** Times a spot is asked about again when Google is unreachable or busy. */
const RETRIES = 3;

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", stop, { once: true });
  });

/**
 * Every spot's answer. Spots that come back unanswered are asked about again,
 * the same spots, so a flaky connection can't change which places are found.
 */
async function ask(probes: [number, number, number][], options: FindOptions): Promise<Metadata[]> {
  const answers: (Metadata | undefined)[] = new Array(probes.length);
  let pending = probes.map((_, i) => i);
  let last = "no reply";
  for (let attempt = 0; attempt <= RETRIES && pending.length > 0; attempt++) {
    aborted(options.signal);
    if (attempt > 0) await pause(400 * 2 ** attempt, options.signal);
    let replies: Metadata[];
    try {
      replies = await options.lookup(
        pending.map((i) => probes[i]),
        options.signal,
      );
    } catch (error) {
      aborted(options.signal);
      if (error instanceof LookupError) throw error;
      last = error instanceof Error ? error.message : String(error);
      continue;
    }
    const still: number[] = [];
    pending.forEach((index, j) => {
      const reply = replies[j];
      if (reply && reply.kind !== "retry") answers[index] = reply;
      else {
        still.push(index);
        if (reply) last = reply.reason;
      }
    });
    pending = still;
  }
  if (pending.length > 0) throw new LookupError(`couldn't reach Google Street View (${last})`, false);
  return answers as Metadata[];
}

export async function findPlaces(options: FindOptions): Promise<Place[]> {
  const pool = poolFor(options.map);
  if (pool.countries.length === 0) throw new LookupError("this map has nowhere to go", false);
  const separation = minimumSeparationKm(options.map);
  const places: Place[] = [];
  const used = new Map<string, number>();

  for (let i = 0; i < options.count; i++) {
    let found: Place | undefined;
    for (let batch = 0; batch < MAX_BATCHES && !found; batch++) {
      const candidates = Array.from({ length: BATCH }, () => draw(pool, used, options.random));
      const results = await ask(
        candidates.map((c) => [c.lat, c.lng, Math.max(1, Math.round(c.radiusKm * 1000))]),
        options,
      );
      for (let j = 0; j < candidates.length && !found; j++) {
        const result = results[j];
        const candidate = candidates[j];
        if (result.kind === "denied") throw new LookupError(result.reason, true);
        if (result.kind !== "found") continue;
        if (haversineKm(candidate.town.lat, candidate.town.lng, result.lat, result.lng) > candidate.town.reach) continue;
        const crowded = places.some(
          (p) => p.pano === result.pano || haversineKm(p.lat, p.lng, result.lat, result.lng) < separation,
        );
        if (crowded) continue;
        found = {
          lat: result.lat,
          lng: result.lng,
          pano: result.pano,
          heading: candidate.heading,
          country: candidate.country,
          ...(result.date ? { date: result.date } : {}),
        };
      }
    }
    if (!found) throw new LookupError("couldn't find enough street view on this map", false);
    places.push(found);
    used.set(found.country, (used.get(found.country) ?? 0) + 1);
    options.onProgress?.(places.length);
  }
  return places;
}
