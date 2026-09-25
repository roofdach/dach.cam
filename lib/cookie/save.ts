import { ACHIEVEMENT_BY_ID } from "./achievements.ts";
import { BUILDINGS } from "./buildings.ts";
import { newGame, type Buff, type BuffKind, type GameState, type GoldenEffect } from "./engine.ts";
import { HEAVENLY_BY_ID, UPGRADE_BY_ID } from "./upgrades.ts";

/**
 * Saves are plain JSON in localStorage, and an export is the same JSON in
 * base64 so it survives being pasted anywhere. Loading trusts nothing: every
 * field is checked, anything unknown is dropped, and anything missing gets the
 * value a new game would have. A save from a future version loads as far as
 * this version understands it.
 */

export const SAVE_KEY = "cookie-save";
/** Where an unreadable save is moved, so a bug never silently deletes progress. */
export const BROKEN_SAVE_KEY = "cookie-save-unreadable";
export const SAVE_VERSION = 1;

interface SavedBuff {
  kind: BuffKind;
  building: string | null;
  left: number;
  total: number;
  cps: number;
  click: number;
}

export interface SaveFile {
  game: "cookie";
  version: number;
  savedAt: number;
  /** Which open tab wrote it; see the tab handoff in the page. */
  owner: string;
  run: {
    cookies: number;
    baked: number;
    handmade: number;
    clicks: number;
    startedAt: number;
    buildings: Record<string, { owned: number; free: number; produced: number }>;
    upgrades: string[];
    unlocked: string[];
    goldenClicks: number;
    buffs: SavedBuff[];
    golden: { x: number; y: number; age: number; life: number } | null;
    nextGolden: number;
    lastEffect: GoldenEffect | null;
  };
  legacy: {
    prestige: number;
    chips: number;
    heavenly: string[];
    bakedBefore: number;
    ascensions: number;
    ascending: boolean;
  };
  totals: GameState["totals"];
  achievements: string[];
  settings: GameState["settings"];
}

export function toSave(state: GameState, savedAt: number, owner: string): SaveFile {
  const { run, legacy } = state;
  return {
    game: "cookie",
    version: SAVE_VERSION,
    savedAt,
    owner,
    run: {
      cookies: run.cookies,
      baked: run.baked,
      handmade: run.handmade,
      clicks: run.clicks,
      startedAt: run.startedAt,
      buildings: Object.fromEntries(
        BUILDINGS.map((b, i) => [b.id, { owned: run.owned[i], free: run.free[i], produced: run.produced[i] }]),
      ),
      upgrades: [...run.upgrades],
      unlocked: [...run.unlocked],
      goldenClicks: run.goldenClicks,
      buffs: run.buffs.map((buff) => ({
        kind: buff.kind,
        building: buff.building >= 0 ? BUILDINGS[buff.building].id : null,
        left: buff.left,
        total: buff.total,
        cps: buff.cps,
        click: buff.click,
      })),
      golden: run.golden && { ...run.golden },
      nextGolden: run.nextGolden,
      lastEffect: run.lastEffect,
    },
    legacy: {
      prestige: legacy.prestige,
      chips: legacy.chips,
      heavenly: [...legacy.heavenly],
      bakedBefore: legacy.bakedBefore,
      ascensions: legacy.ascensions,
      ascending: legacy.ascending,
    },
    totals: { ...state.totals },
    achievements: [...state.achievements],
    settings: { ...state.settings },
  };
}

export const serialize = (state: GameState, savedAt: number, owner: string) =>
  JSON.stringify(toSave(state, savedAt, owner));

/* ----------------------------------------------------------------- read */

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const object = (value: unknown): Loose => (isObject(value) ? value : {});
/** A finite, non-negative number, or the fallback. */
const amount = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, Number.MAX_VALUE) : fallback;
const whole = (value: unknown, fallback = 0) => Math.floor(amount(value, fallback));
const within = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
/** A moment in the past; anything later than now is now. */
const moment = (value: unknown, now: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, now) : now;
const known = (value: unknown, table: ReadonlyMap<string, unknown>) =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && table.has(id)) : [];

const BUFF_KINDS = new Set<BuffKind>(["frenzy", "click-frenzy", "building"]);
const EFFECTS = new Set<GoldenEffect>(["frenzy", "lucky", "click-frenzy", "building"]);
const BUILDING_INDEX = new Map(BUILDINGS.map((b, i) => [b.id, i]));
const DAY = 86_400;

function readBuff(value: unknown): Buff | null {
  const raw = object(value);
  const kind = raw.kind as BuffKind;
  if (!BUFF_KINDS.has(kind)) return null;
  const building = kind === "building" ? BUILDING_INDEX.get(raw.building as string) : -1;
  if (building === undefined) return null;
  const left = within(raw.left, 0, DAY, 0);
  if (!(left > 0)) return null;
  // Multipliers come from the kind, so a save can't carry one this game wouldn't give.
  return {
    kind,
    building,
    left,
    total: within(raw.total, left, DAY, left),
    cps: kind === "frenzy" ? 7 : kind === "building" ? within(raw.cps, 1, 1e6, 1) : 1,
    click: kind === "click-frenzy" ? 777 : 1,
  };
}

export interface Loaded {
  state: GameState;
  savedAt: number;
  owner: string;
}

/** Reads a save, or returns null if it isn't one. Never throws. */
export function parseSave(text: string, now: number): Loaded | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data) || data.game !== "cookie") return null;

  const state = newGame(now);
  const run = object(data.run);
  const legacy = object(data.legacy);
  const totals = object(data.totals);
  const settings = object(data.settings);

  const buildings = object(run.buildings);
  BUILDINGS.forEach((building, i) => {
    const saved = object(buildings[building.id]);
    state.run.owned[i] = whole(saved.owned);
    state.run.free[i] = whole(saved.free);
    state.run.produced[i] = amount(saved.produced);
  });

  state.run.cookies = amount(run.cookies);
  state.run.baked = amount(run.baked);
  state.run.handmade = amount(run.handmade);
  state.run.clicks = whole(run.clicks);
  state.run.startedAt = moment(run.startedAt, now);
  state.run.upgrades = new Set(known(run.upgrades, UPGRADE_BY_ID));
  state.run.unlocked = new Set([...known(run.unlocked, UPGRADE_BY_ID), ...state.run.upgrades]);
  state.run.goldenClicks = whole(run.goldenClicks);
  state.run.buffs = (Array.isArray(run.buffs) ? run.buffs : [])
    .map(readBuff)
    .filter((buff): buff is Buff => buff !== null)
    .filter((buff, i, all) => all.findIndex((b) => b.kind === buff.kind && b.building === buff.building) === i);

  if (isObject(run.golden)) {
    const life = within(run.golden.life, 1, 60, 13);
    const age = within(run.golden.age, 0, life, 0);
    state.run.golden =
      age < life ? { x: within(run.golden.x, 0, 1, 0.5), y: within(run.golden.y, 0, 1, 0.5), age, life } : null;
  }
  state.run.nextGolden = within(run.nextGolden, 0, 900, state.run.nextGolden);
  state.run.lastEffect = EFFECTS.has(run.lastEffect as GoldenEffect) ? (run.lastEffect as GoldenEffect) : null;

  state.legacy.prestige = whole(legacy.prestige);
  state.legacy.chips = whole(legacy.chips);
  state.legacy.heavenly = new Set(known(legacy.heavenly, HEAVENLY_BY_ID));
  state.legacy.bakedBefore = amount(legacy.bakedBefore);
  state.legacy.ascensions = whole(legacy.ascensions);
  state.legacy.ascending = legacy.ascending === true;

  state.totals = {
    clicks: whole(totals.clicks),
    handmade: amount(totals.handmade),
    goldenClicks: whole(totals.goldenClicks),
    goldenMissed: whole(totals.goldenMissed),
    newsClicks: whole(totals.newsClicks),
    startedAt: moment(totals.startedAt, now),
    played: amount(totals.played),
  };
  state.achievements = new Set(known(data.achievements, ACHIEVEMENT_BY_ID));
  state.settings = {
    numbers: settings.numbers === "short" ? "short" : "long",
    effects: settings.effects !== false,
    bulk: settings.bulk === 10 || settings.bulk === 100 ? settings.bulk : 1,
  };

  return {
    state,
    savedAt: moment(data.savedAt, now),
    owner: typeof data.owner === "string" ? data.owner : "",
  };
}

/* ------------------------------------------------------- export, import */

export function encodeExport(json: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(json)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Accepts an export, or the raw JSON if that's what got pasted. */
export function decodeImport(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  try {
    const binary = atob(trimmed.replace(/\s+/g, ""));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}
