/**
 * The daily: the same five places for everyone, changing at midnight UTC.
 * The places come from a seed made of the date, so nothing has to be stored
 * anywhere for everyone to get the same game.
 */

import type { MapId } from "./maps.ts";
import { MAX_POINTS } from "./score.ts";

export const DAILY_MAP: MapId = "world";
export const DAILY_ROUNDS = 5;
/** Seconds per round. */
export const DAILY_TIME = 120;

/** Daily #1. */
const FIRST_DAY = Date.UTC(2026, 8, 25);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's date in UTC, as YYYY-MM-DD. */
export function dailyDate(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function dailyNumber(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - FIRST_DAY) / DAY_MS) + 1;
}

export function dailySeed(date: string): string {
  return `geo daily ${date}`;
}

export function msUntilNextDaily(now = Date.now()): number {
  return DAY_MS - (now % DAY_MS);
}

/** One square a round, like the word games. */
export function scoreSquare(points: number): string {
  if (points >= MAX_POINTS * 0.9) return "🟩";
  if (points >= MAX_POINTS * 0.6) return "🟨";
  if (points >= MAX_POINTS * 0.3) return "🟧";
  if (points > 0) return "🟥";
  return "⬛";
}
