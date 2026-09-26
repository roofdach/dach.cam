/**
 * The rules of the shape game, the same in the browser and on the server:
 * which country someone means by what they typed, how far and which way a
 * wrong guess is from the answer, the day's country, and the quiz.
 */

import { haversineKm } from "../geo/earth.ts";
import { seededRandom, type Random } from "../random.ts";
import { COUNTRIES, type Country } from "./data.ts";

export type { Country };

export const BY_CODE: ReadonlyMap<string, Country> = new Map(COUNTRIES.map((c) => [c.code, c]));
/** The countries that come up to guess. */
export const TARGETS: readonly Country[] = COUNTRIES.filter((c) => c.target);
export const MAX_GUESSES = 6;
/** As far apart as two places on earth can be, near enough. */
export const MAX_KM = 20_000;

/* --------------------------------------------------------------- names */

/** Lowercase, no accents or punctuation, single spaces, no leading "the". */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

const INDEX = COUNTRIES.flatMap((country) => [country.name, ...country.aliases].map((name) => ({ key: normalize(name), country })));

/** The country a name means, if it means exactly one. */
export function findCountry(text: string): Country | null {
  const key = normalize(text);
  return key ? (INDEX.find((entry) => entry.key === key)?.country ?? null) : null;
}

/** What someone might mean so far: names that start with it, then a word that does, then any that contain it. */
export function suggest(text: string, limit = 6, exclude: ReadonlySet<string> = new Set()): Country[] {
  const key = normalize(text);
  if (!key) return [];
  const ranked: [number, Country][] = [];
  const seen = new Set<string>();
  for (const { key: name, country } of INDEX) {
    if (exclude.has(country.code)) continue;
    const rank = name === key ? 0 : name.startsWith(key) ? 1 : name.includes(` ${key}`) ? 2 : name.includes(key) ? 3 : -1;
    if (rank >= 0) ranked.push([rank, country]);
  }
  ranked.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  const out: Country[] = [];
  for (const [, country] of ranked) {
    if (seen.has(country.code)) continue;
    seen.add(country.code);
    out.push(country);
    if (out.length === limit) break;
  }
  return out;
}

/* --------------------------------------------------------------- hints */

const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
const ARROW_EMOJI = ["⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️"];

export interface Hint {
  code: string;
  km: number;
  /** Which way the answer lies from the guess, 0 to 7 clockwise from north. */
  direction: number;
  /** How close, from 0 (the far side of the world) to 100 (it). */
  proximity: number;
}

/** Initial bearing from one point to another, in degrees clockwise from north. */
export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lng2 - lng1) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

export function hintFor(guess: Country, answer: Country): Hint {
  if (guess.code === answer.code) return { code: guess.code, km: 0, direction: 0, proximity: 100 };
  const km = Math.round(haversineKm(guess.lat, guess.lng, answer.lat, answer.lng));
  const direction = Math.round(bearing(guess.lat, guess.lng, answer.lat, answer.lng) / 45) % 8;
  return { code: guess.code, km, direction, proximity: Math.max(0, Math.min(99, Math.floor((1 - km / MAX_KM) * 100))) };
}

export const arrow = (hint: Hint) => (hint.proximity === 100 ? "🎉" : ARROWS[hint.direction]);

/** A row of five squares, filled as far as a guess was close. */
export function squares(proximity: number): string {
  const full = Math.floor(proximity / 20);
  const half = proximity - full * 20 >= 10 ? 1 : 0;
  return "🟩".repeat(full) + "🟨".repeat(half) + "⬜".repeat(5 - full - half);
}

/** What to paste to friends: how many guesses it took, and how close each was, without the answer. */
export function shareText(title: string, hints: readonly Hint[], won: boolean, url: string): string {
  const rows = hints.map((h) => `${squares(h.proximity)}${h.proximity === 100 ? "🎉" : ARROW_EMOJI[h.direction]}`);
  return `${title} ${won ? hints.length : "X"}/${MAX_GUESSES}\n${rows.join("\n")}\n${url}`;
}

/* --------------------------------------------------------------- daily */

/** Today, as the daily counts days: by UTC, so it turns over at the same moment for everyone. */
export function dailyDate(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

const FIRST_DAILY = Date.UTC(2026, 8, 26);

export function dailyNumber(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - FIRST_DAILY) / 86_400_000) + 1;
}

export function msUntilNextDaily(now = Date.now()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now;
}

function shuffled<T>(list: readonly T[], random: Random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const DAILY_ORDER = shuffled(TARGETS, seededRandom("shape:daily"));

/** The day's country: everyone's the same, and every country comes up once before any comes up again. */
export function dailyAnswer(date: string): Country {
  const n = dailyNumber(date) - 1;
  return DAILY_ORDER[((n % DAILY_ORDER.length) + DAILY_ORDER.length) % DAILY_ORDER.length];
}

/** Some countries to guess, in an order a seed decides: the same seed, the same countries. */
export function pickTargets(seed: string, count: number, from: readonly Country[] = TARGETS): Country[] {
  return shuffled(from, seededRandom(seed)).slice(0, count);
}

/* ---------------------------------------------------------------- quiz */

/** Everyone else, nearest first, for wrong answers that are hard to rule out. */
function nearest(country: Country, keep: (c: Country) => boolean): Country[] {
  return COUNTRIES.filter((c) => c.code !== country.code && keep(c))
    .map((c) => [haversineKm(country.lat, country.lng, c.lat, c.lng), c] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c);
}

export interface QuizRound {
  answer: string;
  /** Four flags, one of them the answer's. */
  flags: string[];
  /** Four capitals, one of them the answer's; null if it hasn't got one to ask about. */
  capitals: string[] | null;
  /** Which of these border it; null for an island with none. */
  neighbours: { options: string[]; correct: string[] } | null;
}

export const QUIZ_ROUNDS = 5;

/** A quiz: countries with a flag and a capital, and for each, wrong answers taken from its neighbourhood. */
export function quiz(seed: string, rounds = QUIZ_ROUNDS): QuizRound[] {
  const random = seededRandom(`${seed}:quiz`);
  const pool = TARGETS.filter((c) => c.flag && c.capital);
  return pickTargets(seed, rounds, pool).map((answer) => {
    const flags = shuffled([answer, ...nearest(answer, (c) => c.flag).slice(0, 3)].map((c) => c.code), random);
    const otherCapitals = nearest(answer, (c) => c.capital !== null && c.capital !== answer.capital).slice(0, 3);
    const capitals = shuffled([answer.capital!, ...otherCapitals.map((c) => c.capital!)], random);
    let neighbours: QuizRound["neighbours"] = null;
    if (answer.neighbours.length > 0) {
      const correct = shuffled(answer.neighbours, random).slice(0, 4);
      const decoys = nearest(answer, (c) => c.target && !answer.neighbours.includes(c.code)).slice(0, 6 - correct.length);
      neighbours = { options: shuffled([...correct, ...decoys.map((c) => c.code)], random), correct: correct.sort() };
    }
    return { answer: answer.code, flags, capitals, neighbours };
  });
}

/** Points for a quiz round: 3 for the outline at the first go down to 1 at the third, and 1 each for flag, capital and neighbours. */
export function quizPoints(outlineGuesses: number | null, flag: boolean, capital: boolean | null, neighbours: boolean | null): number {
  const outline = outlineGuesses === null ? 0 : Math.max(0, 4 - outlineGuesses);
  return outline + (flag ? 1 : 0) + (capital ? 1 : 0) + (neighbours ? 1 : 0);
}

/** The flag's picture. */
export const flagUrl = (code: string) => `/flags/${code.toLowerCase()}.svg`;
