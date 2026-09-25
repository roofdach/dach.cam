/**
 * Builds the data behind /geo from two open datasets:
 *
 * - lib/geo/data/seeds.ts, the towns a round starts from. Every town comes
 *   with a reach: how far a round may wander from it before it could end up
 *   in another country. That is what lets the game name the country without
 *   shipping borders to the browser.
 * - lib/geo/data/scales.ts, how big each map is, which sets how quickly
 *   points fall off with distance, and where it is, for framing the map.
 *
 * Towns are GeoNames (CC BY 4.0) by way of `all-the-cities`; borders are
 * Natural Earth 1:10m (public domain) by way of `world-atlas`. Run it again
 * after changing lib/geo/maps.ts:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/geo-data.mts
 */

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import countryCodes from "i18n-iso-countries";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

import { COUNTRY_NAMES } from "../lib/geo/countries.ts";
import { MAPS, PLAYABLE_COUNTRIES, inBand, type MapId } from "../lib/geo/maps.ts";
import { WORLD_SCALE_KM, haversineKm } from "../lib/geo/earth.ts";

const require = createRequire(import.meta.url);

interface Town {
  country: string;
  population: number;
  loc: { coordinates: [number, number] };
}

/** How far a round may wander from its town at most, in km. */
const MAX_REACH = 30;
/** Borders are only accurate to a few hundred metres at 1:10m, so keep this much clear of them. */
const BORDER_MARGIN = 1;
/** A town further than this outside its own country's outline is probably mislabelled. */
const MAX_OFFSHORE = 5;
/** The most towns kept per country; denser countries get coarser cells. */
const MAX_TOWNS = 600;
/** A town's pull grows with population, but slowly, so villages still come up. */
const POPULATION_EXPONENT = 0.35;

const KM_PER_DEGREE = (6371.0088 * Math.PI) / 180;

/* ------------------------------------------------------------ borders */

/** Places whose outline Natural Earth draws inside another country's. */
const ALSO_OWN: Record<string, string[]> = { MQ: ["FR"], RE: ["FR"] };
/** Natural Earth units without an ISO number. */
const UNNUMBERED: Record<string, string> = { Kosovo: "XK", "Indian Ocean Ter.": "CX" };

type Ring = [number, number][];
interface Outline {
  code: string;
  rings: Ring[];
}

const topology = require("world-atlas/countries-10m.json") as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const outlines: Outline[] = feature(topology, topology.objects.countries).features.flatMap((f) => {
  const name = f.properties?.name ?? "";
  const code =
    (f.id !== undefined ? countryCodes.numericToAlpha2(String(f.id)) : undefined) ?? UNNUMBERED[name] ?? `~${name}`;
  const geometry = f.geometry;
  if (!geometry) return [];
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return [{ code, rings: polygons.flat() as Ring[] }];
});

for (const code of PLAYABLE_COUNTRIES) {
  if (!COUNTRY_NAMES[code]) throw new Error(`no name for ${code} in lib/geo/countries.ts`);
  const own = [code, ...(ALSO_OWN[code] ?? [])];
  if (!outlines.some((o) => own.includes(o.code))) throw new Error(`no Natural Earth outline for ${code}`);
}

/** Every border segment, bucketed into quarter-degree cells so a town only looks at its neighbours. */
const CELL = 0.25;
const COLUMNS = 360 / CELL;
interface Segment {
  code: string;
  outline: Outline;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
const grid = new Map<number, Segment[]>();
const cellKey = (row: number, column: number) => row * COLUMNS + (((column % COLUMNS) + COLUMNS) % COLUMNS);

for (const outline of outlines) {
  for (const ring of outline.rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[i + 1];
      const segment = { code: outline.code, outline, ax, ay, bx, by };
      for (let row = Math.floor(Math.min(ay, by) / CELL); row <= Math.floor(Math.max(ay, by) / CELL); row++) {
        for (let column = Math.floor(Math.min(ax, bx) / CELL); column <= Math.floor(Math.max(ax, bx) / CELL); column++) {
          const key = cellKey(row, column);
          const bucket = grid.get(key);
          if (bucket) bucket.push(segment);
          else grid.set(key, [segment]);
        }
      }
    }
  }
}

/** Longitude difference folded into [-180, 180). */
const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** Distance from a point to a segment, on a flat projection centred on the point; fine at tens of km. */
function segmentKm(lat: number, lng: number, s: Segment): number {
  const k = Math.cos((lat * Math.PI) / 180) * KM_PER_DEGREE;
  const ax = wrap(s.ax - lng) * k;
  const ay = (s.ay - lat) * KM_PER_DEGREE;
  const bx = wrap(s.bx - lng) * k;
  const by = (s.by - lat) * KM_PER_DEGREE;
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Even-odd ray cast; outlines never straddle the antimeridian in this dataset except by splitting. */
function inside(lat: number, lng: number, outline: Outline): boolean {
  let hit = false;
  for (const ring of outline.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** Segments within `km` of a point, found through the grid. */
function nearby(lat: number, lng: number, km: number): Segment[] {
  const found = new Set<Segment>();
  const dLat = km / KM_PER_DEGREE;
  const dLng = km / (KM_PER_DEGREE * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  for (let row = Math.floor((lat - dLat) / CELL); row <= Math.floor((lat + dLat) / CELL); row++) {
    for (let column = Math.floor((lng - dLng) / CELL); column <= Math.floor((lng + dLng) / CELL); column++) {
      for (const segment of grid.get(cellKey(row, column)) ?? []) found.add(segment);
    }
  }
  return [...found];
}

/**
 * How far a round may roam from a town and still be in the town's country,
 * or null if the town isn't safely inside its own country at all.
 */
function reachOf(lat: number, lng: number, country: string): number | null {
  const own = new Set([country, ...(ALSO_OWN[country] ?? [])]);
  const segments = nearby(lat, lng, MAX_REACH + BORDER_MARGIN + MAX_OFFSHORE);

  let foreign = Infinity;
  const foreignOutlines = new Set<Outline>();
  let ownEdge = Infinity;
  for (const segment of segments) {
    const km = segmentKm(lat, lng, segment);
    if (own.has(segment.code)) ownEdge = Math.min(ownEdge, km);
    else {
      foreign = Math.min(foreign, km);
      foreignOutlines.add(segment.outline);
    }
  }

  for (const outline of foreignOutlines) if (inside(lat, lng, outline)) return null;
  const home = outlines.filter((o) => own.has(o.code)).some((o) => inside(lat, lng, o));
  if (!home && ownEdge > MAX_OFFSHORE) return null;

  const reach = Math.min(MAX_REACH, foreign - BORDER_MARGIN);
  return reach >= 0.5 ? reach : null;
}

/* -------------------------------------------------------------- towns */

interface Seed {
  lat: number;
  lng: number;
  weight: number;
  reach: number;
}

const towns = (require("all-the-cities") as Town[]).filter((t) => t.population > 0);
const playable = new Set(PLAYABLE_COUNTRIES);
const byCountry = new Map<string, Town[]>();
for (const town of towns) {
  if (!playable.has(town.country)) continue;
  const list = byCountry.get(town.country);
  if (list) list.push(town);
  else byCountry.set(town.country, [town]);
}

/** Merge towns into cells, keeping the biggest town of each and the pull of all of them. */
function cells(list: Town[], size: number) {
  const merged = new Map<string, { town: Town; weight: number }>();
  for (const town of list) {
    const [lng, lat] = town.loc.coordinates;
    const key = `${Math.floor(lat / size)}:${Math.floor(lng / size)}`;
    const pull = town.population ** POPULATION_EXPONENT;
    const cell = merged.get(key);
    if (!cell) merged.set(key, { town, weight: pull });
    else {
      cell.weight += pull;
      if (town.population > cell.town.population) cell.town = town;
    }
  }
  return [...merged.values()];
}

const seeds = new Map<string, Seed[]>();
const dropped: string[] = [];
for (const country of PLAYABLE_COUNTRIES) {
  const list = byCountry.get(country) ?? [];
  if (list.length === 0) throw new Error(`GeoNames has no towns in ${country}`);

  let size = 0.05;
  let merged = cells(list, size);
  while (merged.length > MAX_TOWNS) merged = cells(list, (size *= 1.25));

  const kept: Seed[] = [];
  for (const { town, weight } of merged) {
    // Stored to a hundredth of a degree, so measure the reach from the stored point.
    const lat = Math.round(town.loc.coordinates[1] * 100) / 100;
    const lng = Math.round(town.loc.coordinates[0] * 100) / 100;
    const reach = reachOf(lat, lng, country);
    if (reach === null) dropped.push(`${country} ${lat},${lng}`);
    else kept.push({ lat, lng, weight, reach });
  }
  if (kept.length === 0) throw new Error(`no usable towns in ${country}`);
  seeds.set(country, kept);
}

/* ------------------------------------------------------------- output */

const order = [...seeds.keys()];
const bytes = new Uint8Array([...seeds.values()].reduce((n, list) => n + list.length, 0) * 6);
const view = new DataView(bytes.buffer);
let offset = 0;
for (const list of seeds.values()) {
  for (const seed of list) {
    view.setInt16(offset, Math.round(seed.lat * 100), true);
    view.setInt16(offset + 2, Math.round(seed.lng * 100), true);
    view.setUint8(offset + 4, Math.max(1, Math.min(255, Math.round(40 * Math.log10(seed.weight)))));
    view.setUint8(offset + 5, Math.floor(seed.reach * 4));
    offset += 6;
  }
}

writeFileSync(
  new URL("../lib/geo/data/seeds.ts", import.meta.url),
  `// Generated by scripts/geo-data.mts from GeoNames (CC BY 4.0) and Natural Earth. Do not edit by hand.

/** The countries, in the order their towns appear in SEED_BYTES. */
export const SEED_COUNTRIES: string[] = ${JSON.stringify(order)};

/** How many towns each country has. */
export const SEED_COUNTS: number[] = ${JSON.stringify(order.map((c) => seeds.get(c)!.length))};

/**
 * Six bytes a town: latitude and longitude in hundredths of a degree (two
 * little-endian int16s), its pull as 40 × log10 (uint8) and how far a round
 * may wander from it in quarter kilometres (uint8).
 */
export const SEED_BYTES =
  "${Buffer.from(bytes).toString("base64")}";
`,
);

/** The smallest longitude span holding every point, which may cross the antimeridian. */
function span(longitudes: number[]): [west: number, east: number] {
  const sorted = [...new Set(longitudes)].sort((a, b) => a - b);
  let gap = sorted[0] + 360 - sorted[sorted.length - 1];
  let west = sorted[0];
  let east = sorted[sorted.length - 1];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > gap) {
      gap = sorted[i] - sorted[i - 1];
      west = sorted[i];
      east = sorted[i - 1];
    }
  }
  return [west, east];
}

const scales = {} as Record<MapId, number>;
const bounds = {} as Record<MapId, [south: number, west: number, north: number, east: number]>;
for (const map of MAPS) {
  const points = Object.keys(map.countries).flatMap((country) => {
    const band = map.longitude?.[country];
    return seeds.get(country)!.filter((s) => !band || inBand(s.lng, band));
  });
  const lats = points.map((p) => p.lat);
  const [west, east] = span(points.map((p) => p.lng));
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  // Across the antimeridian the east edge goes past 180, which is how a map library wants it.
  bounds[map.id] = map.id === "world" ? [-60, -180, 78, 180] : [south, west, north, east < west ? east + 360 : east];
  // A continent can be wider corner to corner than GeoGuessr says the world is; never be kinder than the world.
  const km = haversineKm(south, west, north, east);
  scales[map.id] = map.id === "world" ? WORLD_SCALE_KM : Math.min(WORLD_SCALE_KM, Math.round(km * 10) / 10);
}

writeFileSync(
  new URL("../lib/geo/data/scales.ts", import.meta.url),
  `// Generated by scripts/geo-data.mts. Do not edit by hand.
import type { MapId } from "../maps.ts";

/**
 * Each map's size in km, corner to corner, which sets how fast points fall
 * off with distance. The world uses GeoGuessr's own figure.
 */
export const MAP_SCALES: Record<MapId, number> = ${JSON.stringify(scales, null, 2)};

/** South, west, north and east edges of where each map's rounds can be, for framing the guess map. */
export const MAP_BOUNDS: Record<MapId, [number, number, number, number]> = ${JSON.stringify(bounds)};
`,
);

const total = order.reduce((n, c) => n + seeds.get(c)!.length, 0);
console.log(`${total} towns in ${order.length} countries, ${bytes.length} bytes; dropped ${dropped.length}`);
console.log(order.map((c) => `${c}:${seeds.get(c)!.length}`).join(" "));
console.log(scales);
