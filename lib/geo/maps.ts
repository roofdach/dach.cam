/**
 * The maps you can play. A map is a weighted list of countries: a round picks
 * a country by weight, then a town in it, then wanders off into the
 * countryside and asks Google for the nearest panorama.
 *
 * Only countries where Google has driven its own cars are listed. Anything
 * missing here simply never comes up; anything listed with thin coverage just
 * costs a few extra lookups, because every panorama is checked before use.
 *
 * `scripts/geo-data.mts` reads this file to decide which towns to keep, so
 * run it again after adding a country.
 */

export type MapId =
  | "world"
  | "europe"
  | "americas"
  | "asia"
  | "africa"
  | "oceania"
  | "ireland"
  | "uk"
  | "usa"
  | "japan"
  | "france";

export interface GeoMap {
  id: MapId;
  name: string;
  blurb: string;
  /** ISO 3166-1 alpha-2 code to relative weight. */
  countries: Record<string, number>;
  /**
   * Keep only the towns of a country inside a band of longitude, from `min`
   * eastwards to `max`. A band with `min` above `max` wraps over the date line.
   */
  longitude?: Record<string, [min: number, max: number]>;
}

export function inBand(lng: number, [min, max]: [number, number]): boolean {
  return min <= max ? lng >= min && lng < max : lng >= min || lng < max;
}

const AMERICAS: Record<string, number> = {
  US: 11, CA: 4.5, MX: 4, GT: 0.6, CR: 0.5, PA: 0.3, DO: 0.6, PR: 0.4, VI: 0.05, BM: 0.05, CW: 0.08, MQ: 0.1,
  CO: 2.2, EC: 1.2, PE: 2, BO: 1, CL: 2.5, AR: 3.5, UY: 0.7, BR: 6, PY: 0.4, GL: 0.15, PM: 0.03, FK: 0.05,
};

const EUROPE: Record<string, number> = {
  RU: 5, UA: 1.8, FR: 3.5, ES: 3, IT: 3, DE: 2.6, GB: 2.6, IE: 0.9, PL: 2, SE: 1.8, NO: 1.8, FI: 1.5, DK: 0.8,
  NL: 0.8, BE: 0.7, CH: 0.7, AT: 0.8, CZ: 0.9, SK: 0.6, HU: 0.8, RO: 1.4, BG: 0.8, GR: 1.1, PT: 1, HR: 0.7,
  SI: 0.4, RS: 0.7, AL: 0.4, MK: 0.3, ME: 0.25, EE: 0.4, LV: 0.4, LT: 0.45, IS: 0.5, LU: 0.15, MT: 0.12, AD: 0.05,
  SM: 0.03, LI: 0.03, IM: 0.06, JE: 0.04, FO: 0.12, XK: 0.15, BA: 0.3,
};

const ASIA: Record<string, number> = {
  TR: 1.8, GE: 0.35, JP: 4.5, KR: 1, TW: 0.9, HK: 0.3, MO: 0.05, PH: 2, TH: 2.3, MY: 1.5, SG: 0.25, ID: 3.5,
  KH: 0.8, LA: 0.5, VN: 1, IN: 3, LK: 0.6, BD: 0.6, BT: 0.15, NP: 0.35, MN: 0.6, KG: 0.4, KZ: 1, IL: 0.5,
  PS: 0.15, JO: 0.4, LB: 0.2, QA: 0.15, AE: 0.35, OM: 0.3, KW: 0.15, CX: 0.02,
};

const AFRICA: Record<string, number> = {
  ZA: 3, BW: 0.8, LS: 0.3, SZ: 0.25, NA: 0.6, KE: 1, UG: 0.6, RW: 0.3, NG: 0.8, GH: 0.6, SN: 0.5, TN: 0.5, RE: 0.15,
};

const OCEANIA: Record<string, number> = { AU: 5, NZ: 2, GU: 0.08, MP: 0.04, AS: 0.04 };

/** Russia counts as Europe up to the Urals and as Asia after them, all the way round past the date line. */
const URALS = 60;
const RUSSIA_IN_EUROPE: [number, number] = [0, URALS];
const RUSSIA_IN_ASIA: [number, number] = [URALS, 0];

export const MAPS: GeoMap[] = [
  {
    id: "world",
    name: "world",
    blurb: "anywhere google has driven",
    countries: { ...AMERICAS, ...EUROPE, ...ASIA, ...AFRICA, ...OCEANIA },
  },
  {
    id: "europe",
    name: "europe",
    blurb: "from the arctic to the canaries",
    countries: EUROPE,
    longitude: { RU: RUSSIA_IN_EUROPE },
  },
  { id: "americas", name: "the americas", blurb: "alaska to tierra del fuego", countries: AMERICAS },
  {
    id: "asia",
    name: "asia",
    blurb: "the levant to japan, and the islands",
    countries: { ...ASIA, RU: 2 },
    longitude: { RU: RUSSIA_IN_ASIA },
  },
  { id: "africa", name: "africa", blurb: "the dozen countries with street view", countries: AFRICA },
  { id: "oceania", name: "oceania", blurb: "australia, new zealand and the pacific", countries: OCEANIA },
  { id: "ireland", name: "ireland", blurb: "the republic, coast to coast", countries: { IE: 1 } },
  { id: "uk", name: "united kingdom", blurb: "england, scotland, wales and the north", countries: { GB: 1 } },
  { id: "usa", name: "united states", blurb: "all fifty states", countries: { US: 1 } },
  { id: "japan", name: "japan", blurb: "hokkaido to okinawa", countries: { JP: 1 } },
  { id: "france", name: "france", blurb: "the mainland and corsica", countries: { FR: 1 } },
];

export const MAP_BY_ID = Object.fromEntries(MAPS.map((map) => [map.id, map])) as Record<MapId, GeoMap>;

export function isMapId(value: unknown): value is MapId {
  return typeof value === "string" && Object.hasOwn(MAP_BY_ID, value);
}

/** Every country any map can send you to. */
export const PLAYABLE_COUNTRIES = [...new Set(MAPS.flatMap((map) => Object.keys(map.countries)))].sort();
