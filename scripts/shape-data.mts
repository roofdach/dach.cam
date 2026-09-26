/**
 * Builds lib/shape/data.ts, everything the shape game knows about the
 * world: each country's outline, where it is, what it's called and what else
 * people call it, its capital and its neighbours. Also copies each country's
 * flag into public/flags, since Windows can't draw flag emoji.
 *
 * Borders are Natural Earth's (public domain) at 1:50m by way of
 * `world-atlas`; capitals are GeoNames' (CC BY 4.0) by way of
 * `all-the-cities`; names are `i18n-iso-countries`; flags are
 * `country-flag-icons` (MIT). Run `npm run shape-data` after changing this.
 */

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import countryCodes from "i18n-iso-countries";
import { feature, neighbors } from "topojson-client";
import type { Feature } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { haversineKm } from "../lib/geo/earth.ts";

const require = createRequire(import.meta.url);
countryCodes.registerLocale(require("i18n-iso-countries/langs/en.json"));

type Point = [number, number];
type Ring = Point[];
type Polygon = Ring[];

/** Natural Earth units without an ISO number: some are countries, some are pieces of one. */
const UNNUMBERED: Record<string, string> = { Kosovo: "XK", "N. Cyprus": "CY", Somaliland: "SO", "Indian Ocean Ter.": "CX" };
const SKIP = new Set(["AQ"]);
/** Only countries at least this big (km²) come up to guess; everything can be guessed. */
const TARGET_AREA = 5000;
/** Islands and pieces this close (km) to the rest of a country are drawn with it; further away (French Guiana, Alaska) aren't. */
const NEAR_KM = 500;
/** Where that's wrong: Norway without Svalbard, as it's drawn on most maps; Malaysia with both halves either side of the sea. */
const NEAR_KM_FOR: Record<string, number> = { NO: 250, MY: 800 };

/** The names people use. The ISO names are often formal ("Russian Federation"). */
const NAMES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", RU: "Russia", KR: "South Korea", KP: "North Korea", IR: "Iran", SY: "Syria",
  VN: "Vietnam", LA: "Laos", BO: "Bolivia", VE: "Venezuela", TZ: "Tanzania", MD: "Moldova", CZ: "Czechia", CD: "DR Congo",
  CG: "Congo", CI: "Ivory Coast", MK: "North Macedonia", BN: "Brunei", FM: "Micronesia", TW: "Taiwan", PS: "Palestine",
  VA: "Vatican City", SZ: "Eswatini", CV: "Cape Verde", TL: "Timor-Leste", XK: "Kosovo", BS: "Bahamas", GM: "Gambia",
  FK: "Falkland Islands", TR: "Turkey", MM: "Myanmar", AE: "United Arab Emirates", DO: "Dominican Republic",
  CF: "Central African Republic", BA: "Bosnia and Herzegovina", VG: "British Virgin Islands", VI: "US Virgin Islands",
  KN: "Saint Kitts and Nevis", VC: "Saint Vincent and the Grenadines", SH: "Saint Helena", PM: "Saint Pierre and Miquelon",
  MF: "Saint Martin", SX: "Sint Maarten", BL: "Saint Barthélemy", HM: "Heard and McDonald Islands", KM: "Comoros",
  NL: "Netherlands", PH: "Philippines", NE: "Niger", SD: "Sudan", SS: "South Sudan", EH: "Western Sahara", MO: "Macao",
  HK: "Hong Kong", KY: "Cayman Islands", TC: "Turks and Caicos Islands", MP: "Northern Mariana Islands", AS: "American Samoa",
  UM: "US Minor Outlying Islands", IO: "British Indian Ocean Territory", TF: "French Southern Lands", GS: "South Georgia",
  WF: "Wallis and Futuna", CC: "Cocos Islands", CX: "Christmas Island", AX: "Åland Islands", FO: "Faroe Islands",
  CN: "China",
};

/** Territories that can be guessed but don't come up: remote, or disputed in ways that would only confuse a class. */
const NOT_TARGETS = new Set(["TF", "HM", "GS", "IO", "UM", "EH", "PS", "FK", "NC", "PR"]);

/** Other names people type. */
const ALIASES: Record<string, string[]> = {
  US: ["usa", "us", "america", "united states of america"],
  GB: ["uk", "britain", "great britain", "england", "scotland", "wales", "northern ireland"],
  NL: ["holland", "the netherlands"], CZ: ["czech republic"], MM: ["burma"], CI: ["cote d'ivoire", "côte d'ivoire"],
  CD: ["drc", "congo kinshasa", "democratic republic of the congo"], CG: ["congo brazzaville", "republic of the congo"],
  AE: ["uae", "emirates"], TR: ["turkiye", "türkiye"], MK: ["macedonia"], SZ: ["swaziland"], TL: ["east timor"],
  CV: ["cabo verde"], KR: ["korea"], BA: ["bosnia"], VA: ["vatican"], KP: ["dprk"], RU: ["russian federation"],
  PS: ["palestinian territories"], VN: ["viet nam"], LA: ["lao"], FK: ["falklands", "malvinas"], VI: ["virgin islands"],
  DO: ["dominican rep"], CF: ["car"], PG: ["png"], NZ: ["aotearoa"], IE: ["eire"], GE: ["sakartvelo"],
};

interface Town {
  name: string;
  country: string;
  featureCode: string;
  population: number;
}

/* ------------------------------------------------------------ geometry */

const RAD = Math.PI / 180;
const KM = 111.32;
const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** A ring laid flat in km around a point, near enough for measuring. */
const flat = (ring: Ring, lng0: number, lat0: number): Point[] =>
  ring.map(([lng, lat]) => [wrap(lng - lng0) * Math.cos(lat0 * RAD) * KM, (lat - lat0) * KM]);

function shoelace(points: Point[]): { area: number; x: number; y: number } {
  let twice = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    twice += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  return twice === 0 ? { area: 0, x: points[0][0], y: points[0][1] } : { area: Math.abs(twice / 2), x: x / (3 * twice), y: y / (3 * twice) };
}

/** A polygon's area in km², less its holes, and its middle. */
function measure(polygon: Polygon): { area: number; lng: number; lat: number } {
  const [lng0, lat0] = polygon[0][0];
  const outer = shoelace(flat(polygon[0], lng0, lat0));
  const holes = polygon.slice(1).reduce((sum, ring) => sum + shoelace(flat(ring, lng0, lat0)).area, 0);
  return { area: Math.max(0, outer.area - holes), lng: wrap(lng0 + outer.x / (Math.cos(lat0 * RAD) * KM)), lat: lat0 + outer.y / KM };
}

/** Douglas–Peucker: the fewest points that stay within `tolerance` of the line. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (index >= 0 && worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** The nearest two polygons' outlines come to each other, in km, near enough. */
function gapKm(a: Ring, b: Ring): number {
  let best = Infinity;
  for (const [lng1, lat1] of a) for (const [lng2, lat2] of b) best = Math.min(best, haversineKm(lat1, lng1, lat2, lng2));
  return best;
}

/** Latitude on a Mercator map, the way most people have seen the world. */
const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2)) / RAD;

/* --------------------------------------------------------------- build */

const topology = require("world-atlas/countries-50m.json") as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const geometries = topology.objects.countries.geometries;
const near = neighbors(geometries);

const nameOf = (i: number) => (geometries[i].properties as { name?: string } | undefined)?.name ?? "";
const codeOf = (i: number) => {
  const g = geometries[i];
  const name = nameOf(i);
  return (g.id !== undefined ? countryCodes.numericToAlpha2(String(g.id)) : undefined) ?? UNNUMBERED[name] ?? null;
};

// Pieces of one country (Cyprus and Northern Cyprus, Somalia and Somaliland) are gathered under its code.
const pieces = new Map<string, { polygons: Polygon[]; next: Set<string> }>();
geometries.forEach((geometry, i) => {
  const code = codeOf(i);
  if (!code || SKIP.has(code)) return;
  const shape = (feature(topology, geometry) as Feature).geometry;
  if (!shape) return;
  const polygons = (shape.type === "Polygon" ? [shape.coordinates] : shape.type === "MultiPolygon" ? shape.coordinates : []) as Polygon[];
  const entry = pieces.get(code) ?? { polygons: [], next: new Set<string>() };
  entry.polygons.push(...polygons);
  for (const j of near[i]) {
    const other = codeOf(j);
    if (other && other !== code && !SKIP.has(other)) entry.next.add(other);
  }
  pieces.set(code, entry);
});

const capitals = new Map<string, Town>();
for (const town of require("all-the-cities") as Town[]) {
  if (town.featureCode !== "PPLC") continue;
  const known = capitals.get(town.country);
  if (!known || town.population > known.population) capitals.set(town.country, town);
}

const flags = "node_modules/country-flag-icons/3x2";
rmSync("public/flags", { recursive: true, force: true });
mkdirSync("public/flags", { recursive: true });

interface Country {
  code: string;
  name: string;
  aliases: string[];
  lat: number;
  lng: number;
  area: number;
  target: boolean;
  w: number;
  h: number;
  path: string;
  capital: string | null;
  neighbours: string[];
  flag: boolean;
}

const countries: Country[] = [];
for (const [code, { polygons, next }] of [...pieces].sort(([a], [b]) => a.localeCompare(b))) {
  const measured = polygons.map((polygon) => ({ polygon, ...measure(polygon) })).sort((a, b) => b.area - a.area);
  const total = measured.reduce((sum, p) => sum + p.area, 0);
  const main = measured[0];

  // Islands and pieces near the main one, or near ones already in, are part of the picture.
  const coarse = (ring: Ring) => simplify(ring, 0.05);
  const kept = [main];
  const keptCoarse = [coarse(main.polygon[0])];
  let grew = true;
  const rest = measured.slice(1).filter((p) => p.area >= main.area * 0.0005);
  while (grew) {
    grew = false;
    for (let i = rest.length - 1; i >= 0; i--) {
      const outline = coarse(rest[i].polygon[0]);
      if (keptCoarse.some((k) => gapKm(k, outline) <= (NEAR_KM_FOR[code] ?? NEAR_KM))) {
        kept.push(rest[i]);
        keptCoarse.push(outline);
        rest.splice(i, 1);
        grew = true;
      }
    }
  }

  // Where it is: the middle of what's drawn, weighted by area.
  const shownArea = kept.reduce((sum, p) => sum + p.area, 0);
  let lat = 0;
  let east = 0;
  for (const p of kept) {
    lat += (p.lat * p.area) / shownArea;
    east += (wrap(p.lng - main.lng) * p.area) / shownArea;
  }
  const lng = wrap(main.lng + east);

  // Drawn on a Mercator map around its own middle, so nothing splits at the date line.
  const projected = kept.flatMap((p) => p.polygon).map((ring) => ring.map(([x, y]): Point => [lng + wrap(x - lng), -mercator(y)]));
  const xs = projected.flat().map((p) => p[0]);
  const ys = projected.flat().map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = 1000 / size;
  let path = "";
  for (const ring of projected) {
    const points = simplify(ring, size * 0.0015).map(([x, y]): Point => [Math.round((x - minX) * scale), Math.round((y - minY) * scale)]);
    const unique = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
    if (unique.length < 4 || shoelace(unique).area < 4) continue;
    path += `M${unique[0][0]} ${unique[0][1]}`;
    for (let i = 1; i < unique.length; i++) path += `${i === 1 ? "l" : " "}${unique[i][0] - unique[i - 1][0]} ${unique[i][1] - unique[i - 1][1]}`;
    path += "z";
  }

  const iso = countryCodes.getName(code, "en") ?? "";
  const name = NAMES[code] ?? (iso || nameOf(geometries.findIndex((_, i) => codeOf(i) === code))) ?? code;
  const others = (countryCodes.getName(code, "en", { select: "all" }) as unknown as string[] | undefined) ?? [];
  const aliases = [...new Set([...others, ...(ALIASES[code] ?? [])].map((a) => a.toLowerCase()).filter((a) => a !== name.toLowerCase()))];
  const flag = existsSync(`${flags}/${code}.svg`);
  if (flag) copyFileSync(`${flags}/${code}.svg`, `public/flags/${code.toLowerCase()}.svg`);

  countries.push({
    code,
    name,
    aliases,
    lat: Math.round(lat * 100) / 100,
    lng: Math.round(lng * 100) / 100,
    area: Math.round(total),
    target: total >= TARGET_AREA && path.length > 0 && !NOT_TARGETS.has(code),
    w: Math.round((maxX - minX) * scale),
    h: Math.round((maxY - minY) * scale),
    path,
    capital: capitals.get(code)?.name ?? null,
    neighbours: [...next].filter((c) => pieces.has(c)).sort(),
    flag,
  });
}

// A name means one country: drop any alias that's another country's name, or that another country goes by
// too, so "Congo" is the Republic of the Congo and not also the DR Congo, as the ISO list has it. The same
// tidying as normalize() in lib/shape/game.ts, which reads what people type.
const said = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
const claims = new Map<string, number>();
for (const c of countries) for (const key of new Set([c.name, ...c.aliases].map(said))) claims.set(key, (claims.get(key) ?? 0) + 1);
for (const c of countries) c.aliases = c.aliases.filter((a) => said(a) !== said(c.name) && claims.get(said(a)) === 1);

const header =`// Generated by scripts/shape-data.mts from Natural Earth (public domain), GeoNames (CC BY 4.0) and
// i18n-iso-countries; don't edit by hand. Outlines are SVG paths in a box up to 1000 across.

export interface Country {
  /** ISO 3166 alpha-2, or XK for Kosovo. */
  code: string;
  name: string;
  /** Other names people type, lowercased. */
  aliases: string[];
  /** The middle of the outline that's shown. */
  lat: number;
  lng: number;
  /** km², all of it. */
  area: number;
  /** Big enough to come up to guess; anything can be guessed. */
  target: boolean;
  w: number;
  h: number;
  path: string;
  capital: string | null;
  /** Countries it shares a land border with. */
  neighbours: string[];
  /** There's a flag for it in public/flags. */
  flag: boolean;
}
`;
writeFileSync("lib/shape/data.ts", `${header}\nexport const COUNTRIES = JSON.parse(${JSON.stringify(JSON.stringify(countries))}) as readonly Country[];\n`);
console.log(
  `${countries.length} countries, ${countries.filter((c) => c.target).length} to guess, ${countries.filter((c) => c.capital).length} capitals, ${countries.filter((c) => c.flag).length} flags; ` +
    `${Math.round(countries.reduce((n, c) => n + c.path.length, 0) / 1024)} KB of outlines`,
);
