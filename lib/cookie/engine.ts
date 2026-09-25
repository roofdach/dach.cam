import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, milkFor, type AchievementContext } from "./achievements.ts";
import { BUILDINGS, CURSOR, GRANDMA } from "./buildings.ts";
import {
  COOKIE_UPGRADES,
  FINGER_UPGRADES,
  HEAVENLY_BY_ID,
  KITTEN_UPGRADES,
  MOUSE_IDS,
  SYNERGY_IDS,
  TIER_IDS,
  UPGRADES,
  UPGRADE_BY_ID,
  grandmasPerPercent,
  type Requirement,
  type Upgrade,
} from "./upgrades.ts";

/**
 * The whole game as plain functions over one state object. Nothing in here
 * knows about the page: time comes in as seconds, randomness as a function,
 * and anything worth telling the player goes out through `notices`.
 */

export const PRICE_GROWTH = 1.15;
export const SELL_BACK = 0.25;
/** Nobody clicks faster than 250 times a second; anything faster is ignored. */
export const MIN_CLICK_GAP_MS = 4;
/** Prestige is the cube root of everything baked, counted in trillions. */
export const PRESTIGE_UNIT = 1e12;
/** Past this, offline baking drops to a tenth. */
export const OFFLINE_FULL_SECONDS = 3600;

export type BuffKind = "frenzy" | "click-frenzy" | "building";

export interface Buff {
  kind: BuffKind;
  /** For a building special, which building. Otherwise -1. */
  building: number;
  /** Seconds left. */
  left: number;
  /** How long it had when it was last topped up, for drawing what remains. */
  total: number;
  /** Multiplier on production. */
  cps: number;
  /** Multiplier on clicks. */
  click: number;
}

export interface GoldenCookie {
  /** Where it sits, as a fraction of the window. */
  x: number;
  y: number;
  /** Seconds it has been showing. */
  age: number;
  /** Seconds it shows for. */
  life: number;
}

export type GoldenEffect = "frenzy" | "lucky" | "click-frenzy" | "building";

export interface Run {
  cookies: number;
  baked: number;
  handmade: number;
  clicks: number;
  /** Milliseconds since the epoch. */
  startedAt: number;
  owned: number[];
  /** Given by a starter kit, so they don't push the price up. */
  free: number[];
  /** Everything each building has baked this run. */
  produced: number[];
  upgrades: Set<string>;
  /** Once an upgrade shows up in the store it stays, even if what unlocked it goes. */
  unlocked: Set<string>;
  goldenClicks: number;
  buffs: Buff[];
  golden: GoldenCookie | null;
  /** Seconds, counted only while the game is on screen. */
  nextGolden: number;
  lastEffect: GoldenEffect | null;
}

export interface Legacy {
  prestige: number;
  chips: number;
  heavenly: Set<string>;
  /** Baked in every run before this one. */
  bakedBefore: number;
  ascensions: number;
  /** Between ascending and starting the next run. */
  ascending: boolean;
}

export interface Totals {
  clicks: number;
  handmade: number;
  goldenClicks: number;
  goldenMissed: number;
  newsClicks: number;
  startedAt: number;
  /** Seconds the game has been open for. */
  played: number;
}

export interface Settings {
  numbers: "long" | "short";
  /** Crumbs, floating numbers and the milk's wave. */
  effects: boolean;
  bulk: 1 | 10 | 100;
}

export type Notice =
  | { kind: "achievement"; id: string }
  | { kind: "golden"; effect: GoldenEffect; amount?: number; seconds?: number; building?: number; multiplier?: number }
  | { kind: "offline"; amount: number; seconds: number };

export interface GameState {
  run: Run;
  legacy: Legacy;
  totals: Totals;
  achievements: Set<string>;
  settings: Settings;
  /** What just happened, for the page to show. Never saved. */
  notices: Notice[];
  /** When the last click counted, in milliseconds. Never saved. */
  lastClickAt: number;
}

export type Random = () => number;

const zeros = () => BUILDINGS.map(() => 0);
/** Keep every total finite, however long someone plays. */
const cap = (value: number) => Math.min(value, Number.MAX_VALUE);
const pick = <T>(list: readonly T[], random: Random): T =>
  list[Math.min(list.length - 1, Math.floor(random() * list.length))];
export const isBuilding = (index: number) => Number.isInteger(index) && index >= 0 && index < BUILDINGS.length;

/* ---------------------------------------------------------------- setup */

function emptyRun(now: number): Run {
  return {
    cookies: 0,
    baked: 0,
    handmade: 0,
    clicks: 0,
    startedAt: now,
    owned: zeros(),
    free: zeros(),
    produced: zeros(),
    upgrades: new Set(),
    unlocked: new Set(),
    goldenClicks: 0,
    buffs: [],
    golden: null,
    nextGolden: 0,
    lastEffect: null,
  };
}

/** A fresh run, with whatever the heavenly upgrades start you off with. */
export function newRun(legacy: Legacy, now: number, random: Random = Math.random): Run {
  const run = emptyRun(now);
  const kits: [id: string, building: number, count: number][] = [
    ["starter-kit", CURSOR, 10],
    ["starter-kitchen", GRANDMA, 5],
  ];
  for (const [id, building, count] of kits) {
    if (legacy.heavenly.has(id)) {
      run.owned[building] += count;
      run.free[building] += count;
    }
  }
  run.nextGolden = goldenDelay({ run, legacy }, random);
  return run;
}

export function newGame(now: number, random: Random = Math.random): GameState {
  const legacy: Legacy = { prestige: 0, chips: 0, heavenly: new Set(), bakedBefore: 0, ascensions: 0, ascending: false };
  return {
    run: newRun(legacy, now, random),
    legacy,
    totals: { clicks: 0, handmade: 0, goldenClicks: 0, goldenMissed: 0, newsClicks: 0, startedAt: now, played: 0 },
    achievements: new Set(),
    settings: { numbers: "long", effects: true, bulk: 1 },
    notices: [],
    lastClickAt: -Infinity,
  };
}

/* ----------------------------------------------------------- production */

export interface Production {
  /** Cookies per second from one of each building, everything included. */
  each: number[];
  /** Cookies per second, everything included. */
  total: number;
  /** What every building's output is multiplied by. */
  multiplier: number;
  /** What the thousand-fingers line adds to each click and each cursor. */
  fingerBonus: number;
  /** How many times the mouse and cursors have been doubled. */
  fingerDoublings: number;
}

export const totalOwned = (state: GameState) => state.run.owned.reduce((sum, count) => sum + count, 0);
export const milk = (state: GameState) => milkFor(state.achievements.size);

export function production(state: GameState, withBuffs = true): Production {
  const { run, legacy } = state;
  const has = (id: string) => run.upgrades.has(id);

  let fingerDoublings = 0;
  let thousand = 0;
  let chain = 1;
  for (const upgrade of FINGER_UPGRADES) {
    if (!has(upgrade.id)) continue;
    if (upgrade.kind === "fingers") fingerDoublings += 1;
    else if (upgrade.kind === "thousand-fingers") thousand += upgrade.power ?? 0;
    else chain *= upgrade.power ?? 1;
  }
  const fingerBonus = thousand * chain * (totalOwned(state) - run.owned[CURSOR]);

  let synergies = 0;
  const each = BUILDINGS.map((building, index) => {
    if (index === CURSOR) return building.cps * 2 ** fingerDoublings + fingerBonus;
    let tiers = 0;
    for (const id of TIER_IDS[index]) if (has(id)) tiers += 1;
    let cps = building.cps * 2 ** tiers;
    const synergy = SYNERGY_IDS[index];
    if (synergy && has(synergy)) {
      synergies += 1;
      cps *= 1 + (run.owned[GRANDMA] * 0.01) / grandmasPerPercent(index);
    }
    return cps;
  });
  // Every synergy also doubles the grandmas themselves.
  each[GRANDMA] *= 2 ** synergies;

  let multiplier = 1 + legacy.prestige * 0.01;
  for (const upgrade of COOKIE_UPGRADES) if (has(upgrade.id)) multiplier *= 1 + (upgrade.power ?? 0) / 100;
  if (legacy.heavenly.has("heavenly-cookies")) multiplier *= 1.1;
  const glass = milk(state);
  for (const upgrade of KITTEN_UPGRADES) if (has(upgrade.id)) multiplier *= 1 + glass * (upgrade.power ?? 0);
  if (legacy.heavenly.has("kitten-angels")) multiplier *= 1 + glass * 0.1;
  if (withBuffs) for (const buff of run.buffs) multiplier *= buff.cps;

  let total = 0;
  for (let i = 0; i < each.length; i++) {
    each[i] *= multiplier;
    total += run.owned[i] * each[i];
  }
  return { each, total: cap(total), multiplier, fingerBonus, fingerDoublings };
}

/** What one click of the big cookie is worth right now. */
export function clickValue(state: GameState, made: Production = production(state)): number {
  let mice = 0;
  for (const id of MOUSE_IDS) if (state.run.upgrades.has(id)) mice += 1;
  let value = 2 ** made.fingerDoublings + made.fingerBonus + made.total * 0.01 * mice;
  for (const buff of state.run.buffs) value *= buff.click;
  return cap(value);
}

/* ----------------------------------------------------------------- store */

const buildingDiscount = (state: GameState) => (state.legacy.heavenly.has("divine-discount") ? 0.99 : 1);

/** What the next `amount` of a building cost, all together. */
export function buildingPrice(state: GameState, index: number, amount = 1): number {
  const count = Math.floor(amount);
  if (!isBuilding(index) || !(count > 0)) return 0;
  const owned = state.run.owned[index];
  const free = state.run.free[index];
  // Anything still below the free count is priced as if it were the first.
  const atBase = Math.min(count, Math.max(0, free - owned));
  const rest = count - atBase;
  const start = Math.max(0, owned + atBase - free);
  const series = atBase + PRICE_GROWTH ** start * ((PRICE_GROWTH ** rest - 1) / (PRICE_GROWTH - 1));
  return Math.ceil(BUILDINGS[index].price * series * buildingDiscount(state));
}

/** What selling up to `amount` of a building would give back. */
export function sellValue(state: GameState, index: number, amount = 1): number {
  if (!isBuilding(index)) return 0;
  const owned = state.run.owned[index];
  const free = state.run.free[index];
  const count = Math.min(owned, Math.floor(amount));
  if (!(count > 0)) return 0;
  // The last `count` bought: any below the free count at the first price, the rest up the curve.
  const first = owned - count;
  const atBase = Math.max(0, Math.min(owned, free) - first);
  const start = Math.max(first, free) - free;
  const series = atBase + PRICE_GROWTH ** start * ((PRICE_GROWTH ** (count - atBase) - 1) / (PRICE_GROWTH - 1));
  return Math.floor(BUILDINGS[index].price * series * buildingDiscount(state) * SELL_BACK);
}

export function buyBuilding(state: GameState, index: number, amount = 1): boolean {
  const count = Math.floor(amount);
  if (state.legacy.ascending || !isBuilding(index) || !(count > 0)) return false;
  const price = buildingPrice(state, index, count);
  if (!(state.run.cookies >= price)) return false;
  state.run.cookies -= price;
  state.run.owned[index] += count;
  return true;
}

/** Sells up to `amount`, and returns how many went. */
export function sellBuilding(state: GameState, index: number, amount = 1): number {
  if (state.legacy.ascending || !isBuilding(index)) return 0;
  const count = Math.min(state.run.owned[index], Math.floor(amount));
  if (!(count > 0)) return 0;
  const value = sellValue(state, index, count);
  state.run.owned[index] -= count;
  state.run.cookies = cap(state.run.cookies + value);
  if (index === GRANDMA) award(state, "how-could-you");
  return count;
}

/** In the store from the start for cursors; the rest once there's been enough baked to afford one, or there's one already. */
export const buildingVisible = (state: GameState, index: number) =>
  index === CURSOR || state.run.owned[index] > 0 || state.run.baked >= BUILDINGS[index].price;

export const upgradePrice = (state: GameState, upgrade: Upgrade) =>
  state.legacy.heavenly.has("divine-sales") ? Math.ceil(upgrade.price * 0.99) : upgrade.price;

/** In the store and not yet bought, cheapest first. */
export function availableUpgrades(state: GameState): Upgrade[] {
  const { unlocked, upgrades } = state.run;
  return UPGRADES.filter((u) => unlocked.has(u.id) && !upgrades.has(u.id)).sort((a, b) => a.price - b.price);
}

export function buyUpgrade(state: GameState, id: string): boolean {
  const upgrade = UPGRADE_BY_ID.get(id);
  const { run } = state;
  if (!upgrade || state.legacy.ascending || run.upgrades.has(id) || !run.unlocked.has(id)) return false;
  const price = upgradePrice(state, upgrade);
  if (!(run.cookies >= price)) return false;
  run.cookies -= price;
  run.upgrades.add(id);
  return true;
}

function meets(state: GameState, requirement: Requirement): boolean {
  const { run } = state;
  switch (requirement.kind) {
    case "owned":
      return run.owned[requirement.building] >= requirement.count;
    case "synergy":
      return run.owned[requirement.building] >= 15 && run.owned[GRANDMA] >= 1;
    case "handmade":
      return run.handmade >= requirement.amount;
    case "baked":
      return run.baked >= requirement.amount;
    case "achievements":
      return state.achievements.size >= requirement.count;
    case "golden":
      return state.totals.goldenClicks >= requirement.count;
  }
}

/** Puts anything newly within reach into the store. Returns whether anything was added. */
export function refreshUnlocks(state: GameState): boolean {
  let changed = false;
  for (const upgrade of UPGRADES) {
    if (!state.run.unlocked.has(upgrade.id) && meets(state, upgrade.requires)) {
      state.run.unlocked.add(upgrade.id);
      changed = true;
    }
  }
  return changed;
}

/* ---------------------------------------------------------------- baking */

function earn(state: GameState, amount: number) {
  state.run.cookies = cap(state.run.cookies + amount);
  state.run.baked = cap(state.run.baked + amount);
}

function bake(state: GameState, seconds: number) {
  const made = production(state);
  if (!(made.total > 0)) return;
  earn(state, made.total * seconds);
  const { run } = state;
  for (let i = 0; i < run.owned.length; i++) {
    run.produced[i] = cap(run.produced[i] + run.owned[i] * made.each[i] * seconds);
  }
}

/**
 * Moves the game on by `seconds`. Long gaps are baked in pieces, split
 * wherever a buff runs out, so a frenzy that ended an hour ago only counts for
 * as long as it lasted. Golden cookies only move on while the game is visible.
 */
export function advance(state: GameState, seconds: number, visible: boolean, random: Random = Math.random) {
  if (state.legacy.ascending || !(seconds > 0) || !Number.isFinite(seconds)) return;
  const { run } = state;
  state.totals.played += seconds;
  run.buffs = run.buffs.filter((buff) => buff.left > 1e-9);

  let left = seconds;
  while (left > 0) {
    let step = left;
    for (const buff of run.buffs) step = Math.min(step, buff.left);
    bake(state, step);
    for (const buff of run.buffs) buff.left -= step;
    run.buffs = run.buffs.filter((buff) => buff.left > 1e-9);
    left -= step;
  }

  if (visible) advanceGolden(state, seconds, random);
}

export function clickCookie(state: GameState, now: number): number {
  if (state.legacy.ascending || now - state.lastClickAt < MIN_CLICK_GAP_MS) return 0;
  state.lastClickAt = now;
  const value = clickValue(state);
  earn(state, value);
  const { run, totals } = state;
  run.handmade = cap(run.handmade + value);
  run.clicks += 1;
  totals.handmade = cap(totals.handmade + value);
  totals.clicks += 1;
  return value;
}

export function clickNews(state: GameState) {
  state.totals.newsClicks += 1;
}

/* ---------------------------------------------------------------- golden */

export function goldenTiming(state: Pick<GameState, "run" | "legacy">) {
  const has = (id: string) => state.run.upgrades.has(id);
  let often = 1;
  let life = 13;
  if (has("lucky-day")) {
    often /= 2;
    life *= 2;
  }
  if (has("serendipity")) {
    often /= 2;
    life *= 2;
  }
  if (state.legacy.heavenly.has("heavenly-luck")) often *= 0.95;
  if (state.legacy.heavenly.has("decisive-fate")) life *= 1.05;
  return { min: 300 * often, max: 900 * often, life };
}

/**
 * Seconds until the next golden cookie. The chance of one appearing climbs
 * from nothing at the minimum to certain at the maximum, checked thirty times
 * a second, which in practice lands most of them in the first third.
 */
export function goldenDelay(state: Pick<GameState, "run" | "legacy">, random: Random = Math.random): number {
  const { min, max } = goldenTiming(state);
  const checks = (max - min) * 30;
  const roll = 1 - random();
  const x = Math.min(1, Math.pow((-6 * Math.log(roll)) / checks, 1 / 6));
  return min + x * (max - min);
}

function advanceGolden(state: GameState, seconds: number, random: Random) {
  const { run } = state;
  if (run.golden) {
    run.golden.age += seconds;
    if (run.golden.age >= run.golden.life) {
      run.golden = null;
      state.totals.goldenMissed += 1;
      run.nextGolden = goldenDelay(state, random);
    }
    return;
  }
  run.nextGolden -= seconds;
  if (run.nextGolden <= 0) {
    run.golden = { x: 0.08 + random() * 0.84, y: 0.12 + random() * 0.76, age: 0, life: goldenTiming(state).life };
  }
}

function pickEffect(state: GameState, random: Random): GoldenEffect {
  const effects: GoldenEffect[] = ["frenzy", "lucky"];
  if (random() < 0.1) effects.push("click-frenzy");
  if (state.run.owned.some((count) => count >= 10) && random() < 0.25) effects.push("building");
  // Mostly avoid giving the same thing twice in a row.
  const last = state.run.lastEffect;
  if (last && effects.length > 1 && effects.includes(last) && random() < 0.8) effects.splice(effects.indexOf(last), 1);
  return pick(effects, random);
}

function gainBuff(state: GameState, buff: Omit<Buff, "total">) {
  const same = state.run.buffs.find((b) => b.kind === buff.kind && b.building === buff.building);
  if (same) {
    // Another of the same adds its time on top.
    same.left += buff.left;
    same.total = same.left;
    same.cps = buff.cps;
    same.click = buff.click;
  } else {
    state.run.buffs.push({ ...buff, total: buff.left });
  }
}

export const hasBuff = (state: GameState, kind: BuffKind) => state.run.buffs.some((buff) => buff.kind === kind);

export function clickGolden(state: GameState, random: Random = Math.random): Notice | null {
  const { run, totals } = state;
  const golden = run.golden;
  if (!golden || state.legacy.ascending) return null;
  run.golden = null;
  run.goldenClicks += 1;
  totals.goldenClicks += 1;
  if (golden.age <= 1) award(state, "quick-draw");
  if (golden.life - golden.age <= 1) award(state, "just-in-time");

  const effect = pickEffect(state, random);
  run.lastEffect = effect;
  let lasts = 1;
  if (run.upgrades.has("get-lucky")) lasts *= 2;
  if (state.legacy.heavenly.has("lasting-fortune")) lasts *= 1.1;

  let notice: Notice;
  if (effect === "lucky") {
    const amount = Math.min(run.cookies * 0.15, production(state).total * 900) + 13;
    earn(state, amount);
    notice = { kind: "golden", effect, amount };
  } else if (effect === "frenzy") {
    const seconds = 77 * lasts;
    gainBuff(state, { kind: "frenzy", building: -1, left: seconds, cps: 7, click: 1 });
    notice = { kind: "golden", effect, seconds, multiplier: 7 };
  } else if (effect === "click-frenzy") {
    const seconds = 13 * lasts;
    gainBuff(state, { kind: "click-frenzy", building: -1, left: seconds, cps: 1, click: 777 });
    notice = { kind: "golden", effect, seconds, multiplier: 777 };
  } else {
    const building = pick(
      run.owned.flatMap((count, index) => (count >= 10 ? [index] : [])),
      random,
    );
    const seconds = 30 * lasts;
    const multiplier = 1 + run.owned[building] * 0.1;
    gainBuff(state, { kind: "building", building, left: seconds, cps: multiplier, click: 1 });
    notice = { kind: "golden", effect, seconds, building, multiplier };
  }
  run.nextGolden = goldenDelay(state, random);
  state.notices.push(notice);
  return notice;
}

/* ---------------------------------------------------------- achievements */

export function award(state: GameState, id: string): boolean {
  if (state.achievements.has(id) || !ACHIEVEMENT_BY_ID.has(id)) return false;
  state.achievements.add(id);
  state.notices.push({ kind: "achievement", id });
  return true;
}

export function checkAchievements(state: GameState, now: number): string[] {
  const { run, legacy, totals } = state;
  const context: AchievementContext = {
    baked: run.baked,
    cps: production(state).total,
    handmade: run.handmade,
    clicks: run.clicks,
    owned: run.owned,
    totalOwned: totalOwned(state),
    upgrades: run.upgrades.size,
    goldenClicks: totals.goldenClicks,
    ascensions: legacy.ascensions,
    prestige: legacy.prestige,
    runSeconds: Math.max(0, (now - run.startedAt) / 1000),
    newsClicks: totals.newsClicks,
    frenzy: hasBuff(state, "frenzy"),
    clickFrenzy: hasBuff(state, "click-frenzy"),
  };
  const earned: string[] = [];
  for (const achievement of ACHIEVEMENTS) {
    if (achievement.test && !state.achievements.has(achievement.id) && achievement.test(context)) {
      if (award(state, achievement.id)) earned.push(achievement.id);
    }
  }
  return earned;
}

/* ---------------------------------------------------------------- legacy */

export const bakedAllTime = (state: GameState) => cap(state.legacy.bakedBefore + state.run.baked);

/** Everything that must have been baked, across all runs, to reach a prestige level. */
export const bakedForPrestige = (level: number) => level ** 3 * PRESTIGE_UNIT;

export function prestigeFor(baked: number): number {
  if (!(baked >= PRESTIGE_UNIT)) return 0;
  // The cube root gets close; the checks settle it against the same sum the
  // store shows, so a level is never a rounding error away from its threshold.
  let level = Math.floor(Math.cbrt(baked / PRESTIGE_UNIT));
  // Past 2^53 a step of one is lost to rounding, and there'd be no point anyway.
  if (!Number.isSafeInteger(level + 1)) return level;
  while (bakedForPrestige(level + 1) <= baked) level += 1;
  while (level > 0 && bakedForPrestige(level) > baked) level -= 1;
  return level;
}

/** Ends the run. Returns how many prestige levels it was worth. */
export function ascend(state: GameState, now: number): number {
  const { legacy } = state;
  if (legacy.ascending) return 0;
  const baked = bakedAllTime(state);
  const level = Math.max(legacy.prestige, prestigeFor(baked));
  const gained = level - legacy.prestige;
  legacy.prestige = level;
  legacy.chips += gained;
  legacy.bakedBefore = baked;
  legacy.ascensions += 1;
  legacy.ascending = true;
  state.run = emptyRun(now);
  return gained;
}

export function buyHeavenly(state: GameState, id: string): boolean {
  const upgrade = HEAVENLY_BY_ID.get(id);
  const { legacy } = state;
  if (!upgrade || !legacy.ascending || legacy.heavenly.has(id) || !(legacy.chips >= upgrade.price)) return false;
  legacy.chips -= upgrade.price;
  legacy.heavenly.add(id);
  return true;
}

export function reincarnate(state: GameState, now: number, random: Random = Math.random) {
  if (!state.legacy.ascending) return;
  state.legacy.ascending = false;
  state.run = newRun(state.legacy, now, random);
}

/* --------------------------------------------------------------- offline */

/** The share of normal production made while the game is closed. */
export function offlineRate(state: GameState): number {
  const { heavenly } = state.legacy;
  if (!heavenly.has("oven-left-on")) return 0;
  let rate = 0.05;
  for (const id of ["guardian-angels", "archangels", "seraphim"]) if (heavenly.has(id)) rate += 0.1;
  return rate;
}

export function offlineEarnings(state: GameState, seconds: number): number {
  const rate = offlineRate(state);
  if (!(rate > 0) || !(seconds > 0) || !Number.isFinite(seconds) || state.legacy.ascending) return 0;
  const full = Math.min(seconds, OFFLINE_FULL_SECONDS);
  const reduced = Math.max(0, seconds - OFFLINE_FULL_SECONDS);
  return cap(production(state, false).total * rate * (full + reduced * 0.1));
}

/** Pays out for time spent closed, and says so. */
export function applyOffline(state: GameState, seconds: number): number {
  const amount = offlineEarnings(state, seconds);
  if (amount > 0) {
    earn(state, amount);
    state.notices.push({ kind: "offline", amount, seconds });
  }
  return amount;
}
