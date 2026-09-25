/**
 * One runnable check for the logic behind the site and the cookie clicker. No framework:
 * `npm run check` either prints a list of ticks or throws.
 *
 * Anything that needs a DOM or a network is left to the browser; what is here
 * is the part that would be silently wrong.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ActivityType, type LanyardActivity, type LanyardData, type LanyardSpotify } from "../lib/lanyard/types.ts";
import { describePresence, FALLBACK_PRESENCE, formatArtists } from "../lib/lanyard/presence.ts";
import { labelForHost, requestOrigin } from "../lib/origin.ts";
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from "../lib/cookie/achievements.ts";
import { BUILDINGS, CURSOR, GRANDMA } from "../lib/cookie/buildings.ts";
import * as game from "../lib/cookie/engine.ts";
import { formatClock, formatDuration, formatNumber } from "../lib/cookie/format.ts";
import { pickHeadline } from "../lib/cookie/news.ts";
import { decodeImport, encodeExport, parseSave, serialize } from "../lib/cookie/save.ts";
import { HEAVENLY, HEAVENLY_BY_ID, TIERS, UPGRADES, UPGRADE_BY_ID } from "../lib/cookie/upgrades.ts";

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

/* ----------------------------------------------------------------- cookie */

const NOW = 1_700_000_000_000;
const FARM = 2;
const MINE = 3;

/** The same numbers every time, cycling. */
const sequence =
  (...values: number[]) =>
  () => {
    const value = values.shift()!;
    values.push(value);
    return value;
  };

/** A small seeded generator, so a failing run can be replayed. */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const near = (actual: number, expected: number, tolerance = 1e-9) =>
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected));
const assertNear = (actual: number, expected: number, what = "", tolerance = 1e-9) =>
  assert.ok(near(actual, expected, tolerance), `${what} ${actual} should be ${expected}`);
const fresh = () => game.newGame(NOW, () => 0.5);
const frenzy = (left: number): game.Buff => ({ kind: "frenzy", building: -1, left, total: left, cps: 7, click: 1 });

await check("the cookie tables have no duplicates and nothing missing", () => {
  for (const [what, list] of [
    ["buildings", BUILDINGS],
    ["upgrades", UPGRADES],
    ["achievements", ACHIEVEMENTS],
    ["heavenly upgrades", HEAVENLY],
  ] as const) {
    assert.equal(new Set(list.map((item) => item.id)).size, list.length, `${what} ids`);
    assert.equal(new Set(list.map((item) => item.name)).size, list.length, `${what} names`);
    for (const item of list) assert.match(item.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, item.id);
  }
  assert.equal(BUILDINGS.length, 20);
  BUILDINGS.forEach((building, i) => {
    if (i > 0) {
      assert.ok(building.price > BUILDINGS[i - 1].price, `${building.name} costs more than the one before`);
      assert.ok(building.cps > BUILDINGS[i - 1].cps, `${building.name} makes more than the one before`);
    }
    const tiers = UPGRADES.filter((u) => u.kind === "tier" && u.building === i);
    assert.equal(tiers.length, i === CURSOR ? 0 : TIERS.length, `${building.name} tiers`);
    const synergies = UPGRADES.filter((u) => u.kind === "synergy" && u.building === i);
    assert.equal(synergies.length, i > GRANDMA ? 1 : 0, `${building.name} synergy`);
  });
  for (const upgrade of UPGRADES) {
    assert.ok(Number.isFinite(upgrade.price) && upgrade.price > 0, upgrade.id);
    assert.ok(upgrade.name && upgrade.effect && upgrade.icon, upgrade.id);
  }
  for (const achievement of ACHIEVEMENTS) assert.ok(achievement.name && achievement.desc, achievement.id);
});

await check("every id the engine names by hand exists", () => {
  const source = readFileSync("lib/cookie/engine.ts", "utf8");
  const named = (pattern: RegExp) => [...source.matchAll(pattern)].map((match) => match[1]);
  const upgradeOrHeavenly = named(/\bhas\("([^"]+)"\)/g);
  assert.ok(upgradeOrHeavenly.length > 10);
  for (const id of upgradeOrHeavenly) assert.ok(UPGRADE_BY_ID.has(id) || HEAVENLY_BY_ID.has(id), id);
  for (const id of named(/award\(state, "([^"]+)"\)/g)) assert.ok(ACHIEVEMENT_BY_ID.has(id), id);
  const lists = source.split("\n").filter((line) => /"(starter-kit|guardian-angels)"/.test(line));
  assert.equal(lists.length, 2);
  for (const line of lists) {
    for (const [, id] of line.matchAll(/"([^"]+)"/g)) assert.ok(HEAVENLY_BY_ID.has(id), id);
  }
  // Every heavenly upgrade does something.
  for (const upgrade of HEAVENLY) assert.ok(source.includes(`"${upgrade.id}"`), upgrade.id);
});

await check("buildings cost what Cookie Clicker charges, 15% more each", () => {
  const state = fresh();
  const cursors: number[] = [];
  for (let k = 0; k < 10; k++) {
    cursors.push(game.buildingPrice(state, CURSOR));
    state.run.owned[CURSOR] += 1;
  }
  assert.deepEqual(cursors, [15, 18, 20, 23, 27, 31, 35, 40, 46, 53]);
  assert.equal(game.buildingPrice(state, GRANDMA), 100);
  assert.equal(game.buildingPrice(state, 19), 540e24);
  for (const owned of [0, 7, 120, 400]) {
    state.run.owned[GRANDMA] = owned;
    let singles = 0;
    for (let k = 0; k < 10; k++) singles += 100 * 1.15 ** (owned + k);
    const bulk = game.buildingPrice(state, GRANDMA, 10);
    assert.ok(bulk >= singles * (1 - 1e-12) && bulk <= singles * (1 + 1e-12) + 1, `${owned}: ${bulk} vs ${singles}`);
  }
  assert.equal(game.buildingPrice(state, GRANDMA, 0), 0);
  const start = fresh();
  assert.ok(game.buildingVisible(start, CURSOR), "cursors are in the store from the start");
  assert.ok(!game.buildingVisible(start, GRANDMA), "grandmas wait until 100 have been baked");
  start.run.baked = 100;
  assert.ok(game.buildingVisible(start, GRANDMA));
  assert.equal(game.buildingPrice(state, 20), 0);
  assert.equal(game.buildingPrice(state, -1), 0);
});

await check("buying spends exactly the price, and never more than there is", () => {
  const state = fresh();
  assert.equal(game.buyBuilding(state, CURSOR), false);
  state.run.cookies = 100;
  assert.equal(game.buyBuilding(state, CURSOR, 10), false, "ten cursors cost more than 100");
  assert.equal(state.run.cookies, 100);
  assert.equal(game.buyBuilding(state, CURSOR), true);
  assert.equal(state.run.cookies, 85);
  assert.equal(state.run.owned[CURSOR], 1);
  const three = game.buildingPrice(state, CURSOR, 3);
  assert.equal(game.buyBuilding(state, CURSOR, 3), true);
  assert.equal(state.run.cookies, 85 - three);
  assert.equal(state.run.owned[CURSOR], 4);
  for (const bad of [0, 0.5, -1, NaN]) assert.equal(game.buyBuilding(state, CURSOR, bad), false, String(bad));
  assert.equal(game.buyBuilding(state, 42), false);
});

await check("selling gives back a quarter, and only what is there", () => {
  const state = fresh();
  state.run.cookies = 1e6;
  game.buyBuilding(state, GRANDMA, 10);
  const expected = Math.floor(100 * (1.15 ** 7 + 1.15 ** 8 + 1.15 ** 9) * 0.25);
  const before = state.run.cookies;
  assert.equal(game.sellValue(state, GRANDMA, 3), expected);
  assert.equal(game.sellBuilding(state, GRANDMA, 3), 3);
  assert.equal(state.run.cookies, before + expected);
  assert.equal(game.sellBuilding(state, GRANDMA, 100), 7, "sells whatever is left");
  assert.equal(game.sellBuilding(state, GRANDMA), 0);
  assert.ok(state.achievements.has("how-could-you"));

  const trader = fresh();
  trader.run.cookies = 1e14;
  for (const building of [CURSOR, MINE, 9]) {
    const cookies = trader.run.cookies;
    assert.ok(game.buyBuilding(trader, building, 10));
    assert.equal(game.sellBuilding(trader, building, 10), 10);
    assert.ok(trader.run.cookies < cookies, "buying and selling back always loses cookies");
  }
});

await check("selling adds up the same as pricing each building on its own", () => {
  const state = fresh();
  for (const [owned, free, count] of [
    [1, 0, 1],
    [10, 0, 3],
    [10, 0, 10],
    [5, 10, 5],
    [12, 10, 5],
    [12, 10, 12],
    [300, 10, 150],
    [450, 5, 100],
  ]) {
    state.run.owned[GRANDMA] = owned;
    state.run.free[GRANDMA] = free;
    let series = 0;
    for (let i = owned - count; i < owned; i++) series += 1.15 ** Math.max(0, i - free);
    const expected = Math.floor(100 * series * 0.25);
    const actual = game.sellValue(state, GRANDMA, count);
    assert.ok(Math.abs(actual - expected) <= Math.max(1, expected * 1e-12), `${owned}/${free}/${count}: ${actual} vs ${expected}`);
  }
  state.run.owned[GRANDMA] = 1e15;
  const started = performance.now();
  game.sellValue(state, GRANDMA, 1e15);
  game.buildingPrice(state, GRANDMA, 1e15);
  assert.ok(performance.now() - started < 50, "no loop over a tampered count");
});

await check("buildings from a starter kit are free and don't raise the price", () => {
  const legacy = { ...fresh().legacy, heavenly: new Set(["starter-kit", "starter-kitchen"]) };
  const state = { ...fresh(), legacy, run: game.newRun(legacy, NOW, () => 0.5) };
  assert.equal(state.run.owned[CURSOR], 10);
  assert.equal(state.run.owned[GRANDMA], 5);
  assert.equal(game.buildingPrice(state, CURSOR), 15);
  assert.equal(game.buildingPrice(state, GRANDMA), 100);
  state.run.owned[CURSOR] = 5;
  assert.equal(game.buildingPrice(state, CURSOR, 5), 75, "the five sold come back at the first price");
  assert.equal(game.buildingPrice(state, CURSOR, 6), 90);
  assert.equal(game.buildingPrice(state, CURSOR, 7), Math.ceil(15 * (6 + 1.15)));
});

await check("production follows the upgrades", () => {
  const state = fresh();
  const cps = () => game.production(state).total;
  state.run.owned[CURSOR] = 10;
  assertNear(cps(), 1, "ten cursors");
  for (const id of ["nimble-fingers", "hand-cream", "two-handed"]) state.run.upgrades.add(id);
  assertNear(cps(), 8, "doubled three times");
  state.run.owned[GRANDMA] = 5;
  assertNear(cps(), 13, "and five grandmas");
  state.run.upgrades.add("thousand-fingers");
  assertNear(cps(), 8 + 10 * 0.1 * 5 + 5, "thousand fingers");
  state.run.upgrades.add("million-fingers");
  assertNear(cps(), 8 + 10 * 0.5 * 5 + 5, "million fingers");
  state.run.upgrades.add("grandma-1");
  assertNear(cps(), 8 + 25 + 10, "a grandma tier");
  state.run.owned[FARM] = 1;
  state.run.upgrades.add("farm-grandmas");
  assertNear(cps(), 10 * (0.8 + 0.5 * 6) + 5 * 1 * 2 * 2 + 8 * (1 + 5 * 0.01), "farmer grandmas");

  const mines = fresh();
  mines.run.owned[GRANDMA] = 20;
  mines.run.owned[MINE] = 10;
  mines.run.upgrades.add("mine-grandmas");
  assertNear(game.production(mines).total, 20 * 2 + 10 * 47 * 1.1, "one percent per two grandmas");
});

await check("multipliers stack the way they say", () => {
  const state = fresh();
  state.run.owned[GRANDMA] = 100;
  const cps = () => game.production(state).total;
  assertNear(cps(), 100);
  state.legacy.prestige = 50;
  assertNear(cps(), 150, "prestige");
  state.run.upgrades.add("butter-cookies");
  state.run.upgrades.add("coconut-macaroons");
  assertNear(cps(), 150 * 1.01 * 1.02, "cookies");
  for (const achievement of ACHIEVEMENTS.slice(0, 25)) state.achievements.add(achievement.id);
  assertNear(game.milk(state), 1);
  state.run.upgrades.add("kitten-helpers");
  assertNear(cps(), 150 * 1.01 * 1.02 * 1.1, "kittens");
  state.legacy.heavenly.add("heavenly-cookies");
  state.legacy.heavenly.add("kitten-angels");
  const base = 150 * 1.01 * 1.02 * 1.1 * 1.1 * 1.1;
  assertNear(cps(), base, "heavenly");
  state.run.buffs.push(frenzy(10));
  assertNear(cps(), base * 7, "frenzy");
  assertNear(game.production(state, false).total, base, "without buffs");
});

await check("a click is worth what the upgrades say", () => {
  const state = fresh();
  assert.equal(game.clickValue(state), 1);
  for (const id of ["nimble-fingers", "hand-cream", "two-handed"]) state.run.upgrades.add(id);
  assert.equal(game.clickValue(state), 8);
  state.run.owned[GRANDMA] = 10;
  state.run.upgrades.add("thousand-fingers");
  assertNear(game.clickValue(state), 9);
  state.run.upgrades.add("plastic-mouse");
  state.run.upgrades.add("iron-mouse");
  const cps = game.production(state).total;
  assertNear(game.clickValue(state), 9 + cps * 0.02);
  state.run.buffs.push({ kind: "click-frenzy", building: -1, left: 5, total: 5, cps: 1, click: 777 });
  assertNear(game.clickValue(state), (9 + cps * 0.02) * 777);
});

await check("clicks count, just not faster than 250 a second", () => {
  const state = fresh();
  assert.equal(game.clickCookie(state, 1000), 1);
  assert.equal(game.clickCookie(state, 1002), 0);
  assert.equal(game.clickCookie(state, 1004), 1);
  assert.equal(state.run.clicks, 2);
  assert.equal(state.totals.clicks, 2);
  assert.equal(state.run.handmade, 2);
  assert.equal(state.run.cookies, 2);
  assert.equal(state.run.baked, 2);
});

await check("time bakes at the going rate, and a buff only counts while it lasts", () => {
  const state = fresh();
  state.run.owned[GRANDMA] = 10;
  game.advance(state, 100, false);
  assertNear(state.run.cookies, 1000);
  state.run.buffs.push(frenzy(77));
  game.advance(state, 100, false);
  assertNear(state.run.cookies, 1000 + 77 * 70 + 23 * 10, "frenzy for 77 of the 100 seconds");
  assert.equal(state.run.buffs.length, 0);
  assertNear(state.run.produced[GRANDMA], state.run.baked, "the grandmas made all of it");

  const once = fresh();
  const often = fresh();
  for (const s of [once, often]) {
    s.run.owned[MINE] = 4;
    s.run.buffs.push(frenzy(30));
  }
  game.advance(once, 60, false);
  for (let i = 0; i < 6000; i++) game.advance(often, 0.01, false);
  assertNear(often.run.cookies, once.run.cookies, "many small steps land where one big one does", 1e-6);

  const before = once.run.cookies;
  for (const nonsense of [0, -5, NaN, Infinity]) game.advance(once, nonsense, true);
  assert.equal(once.run.cookies, before);
});

await check("golden cookies come every five to fifteen minutes, sooner with upgrades", () => {
  const state = fresh();
  const random = seededRandom(7);
  const delays = Array.from({ length: 4000 }, () => game.goldenDelay(state, random)).sort((a, b) => a - b);
  assert.ok(delays[0] >= 300 && delays.at(-1)! <= 900);
  const median = delays[2000];
  assert.ok(median > 425 && median < 475, `median ${median}, expected about 449`);
  state.run.upgrades.add("lucky-day");
  assert.deepEqual(game.goldenTiming(state), { min: 150, max: 450, life: 26 });
  state.run.upgrades.add("serendipity");
  state.legacy.heavenly.add("heavenly-luck");
  state.legacy.heavenly.add("decisive-fate");
  const timing = game.goldenTiming(state);
  assertNear(timing.min, 75 * 0.95);
  assertNear(timing.life, 52 * 1.05);
});

await check("a golden cookie shows while the game is visible, and leaves if nobody clicks it", () => {
  const state = fresh();
  state.run.nextGolden = 10;
  game.advance(state, 20, false);
  assert.equal(state.run.golden, null, "not while hidden");
  game.advance(state, 11, true);
  assert.ok(state.run.golden, "appears");
  game.advance(state, 12.9, true);
  assert.ok(state.run.golden, "still there");
  game.advance(state, 0.2, true);
  assert.equal(state.run.golden, null, "gone");
  assert.equal(state.totals.goldenMissed, 1);
  assert.ok(state.run.nextGolden >= 300);
});

await check("golden cookie effects do what they say", () => {
  const golden = (overrides: Partial<game.GoldenCookie> = {}): game.GoldenCookie => ({ x: 0.5, y: 0.5, age: 5, life: 13, ...overrides });

  const lucky = fresh();
  lucky.run.owned[GRANDMA] = 100;
  lucky.run.cookies = 1e6;
  lucky.run.golden = golden();
  // no click frenzy, no building special, then the second of [frenzy, lucky]
  const notice = game.clickGolden(lucky, sequence(0.9, 0.9, 0.6, 0.5));
  assert.deepEqual(notice, { kind: "golden", effect: "lucky", amount: 90_013 });
  assertNear(lucky.run.cookies, 1e6 + 90_013, "the smaller of 15% of the bank and 15 minutes of production, plus 13");
  assert.equal(lucky.run.golden, null);
  assert.equal(lucky.totals.goldenClicks, 1);
  assert.equal(lucky.run.goldenClicks, 1);
  assert.equal(game.clickGolden(lucky, Math.random), null, "only once");

  const frenzied = fresh();
  frenzied.run.golden = golden();
  game.clickGolden(frenzied, sequence(0.9, 0.1, 0.5));
  assert.deepEqual(frenzied.run.buffs, [frenzy(77)]);
  frenzied.run.golden = golden();
  frenzied.run.lastEffect = null;
  game.clickGolden(frenzied, sequence(0.9, 0.1, 0.5));
  assert.equal(frenzied.run.buffs.length, 1, "a second frenzy extends the first");
  assert.equal(frenzied.run.buffs[0].left, 154);

  const clicky = fresh();
  clicky.run.golden = golden();
  clicky.run.upgrades.add("get-lucky");
  game.clickGolden(clicky, sequence(0.05, 0.9, 0.99, 0.5));
  assert.deepEqual(clicky.run.buffs, [{ kind: "click-frenzy", building: -1, left: 26, total: 26, cps: 1, click: 777 }]);

  const special = fresh();
  special.run.owned[FARM] = 20;
  special.run.golden = golden();
  special.legacy.heavenly.add("lasting-fortune");
  game.clickGolden(special, sequence(0.9, 0.1, 0.99, 0.5, 0.5));
  assert.equal(special.run.buffs.length, 1);
  const [buff] = special.run.buffs;
  assert.equal(buff.kind, "building");
  assert.equal(buff.building, FARM);
  assertNear(buff.cps, 3, "10% per farm");
  assertNear(buff.left, 33, "30 seconds, 10% longer");

  // The same effect twice in a row is avoided most of the time.
  const repeat = fresh();
  repeat.run.golden = golden();
  repeat.run.lastEffect = "frenzy";
  game.clickGolden(repeat, sequence(0.9, 0.5, 0.0, 0.5));
  assert.equal(repeat.run.lastEffect, "lucky");

  const quick = fresh();
  quick.run.golden = golden({ age: 0.5 });
  game.clickGolden(quick, sequence(0.9, 0.9, 0.6, 0.5));
  assert.ok(quick.achievements.has("quick-draw") && !quick.achievements.has("just-in-time"));
  const late = fresh();
  late.run.golden = golden({ age: 12.5 });
  game.clickGolden(late, sequence(0.9, 0.9, 0.6, 0.5));
  assert.ok(late.achievements.has("just-in-time") && !late.achievements.has("quick-draw"));
});

await check("upgrades appear when earned, and stay when what earned them is sold", () => {
  const state = fresh();
  state.run.cookies = 1e4;
  game.buyBuilding(state, GRANDMA);
  assert.equal(game.refreshUnlocks(state), true);
  assert.ok(state.run.unlocked.has("grandma-1") && !state.run.unlocked.has("grandma-2"));
  game.sellBuilding(state, GRANDMA);
  assert.equal(game.refreshUnlocks(state), false);
  assert.deepEqual(
    game.availableUpgrades(state).map((u) => u.id),
    ["grandma-1"],
  );
  assert.equal(game.buyUpgrade(state, "grandma-1"), true);
  assert.equal(state.run.cookies, 1e4 - 100 + 25 - 1000);
  assert.equal(game.buyUpgrade(state, "grandma-1"), false, "only once");
  assert.equal(game.buyUpgrade(state, "grandma-2"), false, "not in the store yet");
  assert.equal(game.buyUpgrade(state, "no-such-thing"), false);
  assert.deepEqual(game.availableUpgrades(state), []);

  const baker = fresh();
  baker.run.baked = 1e6 / 20;
  game.refreshUnlocks(baker);
  assert.ok(baker.run.unlocked.has("butter-cookies"), "cookies show up at a twentieth of their price");
});

await check("achievements unlock at their thresholds, once each", () => {
  const state = fresh();
  assert.deepEqual(game.checkAchievements(state, NOW), []);
  state.run.baked = 1000;
  assert.deepEqual(game.checkAchievements(state, NOW).sort(), ["baked-1e0", "baked-1e3"]);
  assert.deepEqual(game.checkAchievements(state, NOW), []);
  assert.equal(state.notices.filter((n) => n.kind === "achievement").length, 2);

  const quick = fresh();
  quick.run.baked = 1e6;
  const ids = game.checkAchievements(quick, NOW + 14 * 60 * 1000);
  for (const id of ["speed-bake-1", "speed-bake-2", "speed-bake-3", "hands-off", "look-no-hands"]) assert.ok(ids.includes(id), id);
  const slow = fresh();
  slow.run.baked = 1e6;
  slow.run.clicks = 16;
  const slowIds = game.checkAchievements(slow, NOW + 30 * 60 * 1000);
  assert.ok(slowIds.includes("speed-bake-1") && !slowIds.includes("speed-bake-2") && !slowIds.includes("hands-off"));

  const collector = fresh();
  collector.run.owned = BUILDINGS.map((_, i) => 200 - i * 10);
  const got = new Set(game.checkAchievements(collector, NOW));
  assert.ok(got.has("full-set") && got.has("own-cursor-200") && got.has("own-you-1"));
  assert.ok(got.has("base-ten"), "10 of the dearest, 20 of the next, up to 200 cursors");
  assert.ok(!got.has("centennial") && !got.has("own-you-50") && !got.has("own-cursor-250"));
  assert.ok(got.has("powers-of-two") === BUILDINGS.every((_, i) => collector.run.owned[i] >= Math.min(2 ** (19 - i), 128)));

  const stormy = fresh();
  stormy.run.buffs.push(frenzy(5), { kind: "click-frenzy", building: -1, left: 5, total: 5, cps: 1, click: 777 });
  assert.ok(game.checkAchievements(stormy, NOW).includes("perfect-storm"));
});

await check("prestige is the cube root of trillions baked", () => {
  for (const [baked, level] of [
    [0, 0],
    [NaN, 0],
    [-1, 0],
    [999_999_999_999, 0],
    [1e12, 1],
    [8e12 - 1, 1],
    [8e12, 2],
    [1e15, 10],
    [1e18, 100],
    [1e21, 1000],
  ]) {
    assert.equal(game.prestigeFor(baked), level, String(baked));
  }
  for (const huge of [1e60, 1e200, Number.MAX_VALUE]) {
    const started = performance.now();
    const level = game.prestigeFor(huge);
    assert.ok(Number.isFinite(level) && level > 0 && performance.now() - started < 50, String(huge));
  }
  for (let level = 1; level < 100_000; level = Math.ceil(level * 1.7)) {
    const needed = game.bakedForPrestige(level);
    assert.equal(game.prestigeFor(needed), level, `exactly ${level}`);
    assert.equal(game.prestigeFor(needed * (1 - 1e-12)), level - 1, `just short of ${level}`);
  }
});

await check("ascending turns the run into prestige and starts over", () => {
  const state = fresh();
  state.run.baked = 8e12;
  state.run.cookies = 5e12;
  state.run.owned[GRANDMA] = 50;
  state.run.upgrades.add("grandma-1");
  state.achievements.add("baked-1e0");
  assert.equal(game.buyHeavenly(state, "oven-left-on"), false, "heavenly upgrades are bought in heaven");

  assert.equal(game.ascend(state, NOW + 1000), 2);
  assert.deepEqual(
    { ...state.legacy, heavenly: [...state.legacy.heavenly] },
    { prestige: 2, chips: 2, heavenly: [], bakedBefore: 8e12, ascensions: 1, ascending: true },
  );
  assert.equal(state.run.cookies, 0);
  assert.equal(game.totalOwned(state), 0);
  assert.equal(state.run.upgrades.size, 0);
  assert.ok(state.achievements.has("baked-1e0"), "achievements stay");
  assert.equal(game.ascend(state, NOW), 0, "not twice");
  game.advance(state, 100, true);
  game.clickCookie(state, NOW);
  assert.equal(state.run.baked, 0, "nothing bakes in heaven");

  assert.equal(game.buyHeavenly(state, "heavenly-cookies"), false, "three chips, and there are two");
  assert.equal(game.buyHeavenly(state, "oven-left-on"), true);
  assert.equal(state.legacy.chips, 1);
  assert.equal(game.buyHeavenly(state, "oven-left-on"), false, "only once");
  assert.equal(game.buyHeavenly(state, "made-up"), false);

  game.reincarnate(state, NOW + 2000);
  assert.equal(state.legacy.ascending, false);
  assert.equal(state.run.startedAt, NOW + 2000);
  assert.equal(game.buyHeavenly(state, "heavenly-cookies"), false, "and not after");

  state.run.baked = 19e12;
  assert.equal(game.ascend(state, NOW + 3000), 1, "8 and 19 trillion is 27, level three");
  state.legacy.chips = 100;
  game.buyHeavenly(state, "starter-kit");
  game.reincarnate(state, NOW + 4000);
  assert.equal(state.run.owned[CURSOR], 10);
  state.run.owned[GRANDMA] = 100;
  assertNear(game.production(state).total, (100 + 10 * 0.1) * 1.03, "three levels is +3%");
});

await check("baking while closed needs the oven left on, and slows after an hour", () => {
  const state = fresh();
  state.run.owned[GRANDMA] = 100;
  assert.equal(game.offlineEarnings(state, 7200), 0);
  state.legacy.heavenly.add("oven-left-on");
  assertNear(game.offlineEarnings(state, 1800), 100 * 0.05 * 1800);
  assertNear(game.offlineEarnings(state, 7200), 100 * 0.05 * (3600 + 360));
  state.legacy.heavenly.add("guardian-angels");
  assertNear(game.offlineEarnings(state, 100), 100 * 0.15 * 100);
  state.run.buffs.push(frenzy(60));
  assertNear(game.offlineEarnings(state, 100), 100 * 0.15 * 100, "buffs don't bake while closed");
  for (const nonsense of [0, -1, NaN, Infinity]) assert.equal(game.offlineEarnings(state, nonsense), 0);
  const amount = game.applyOffline(state, 100);
  assertNear(state.run.cookies, amount);
  assert.deepEqual(state.notices.at(-1), { kind: "offline", amount, seconds: 100 });
});

await check("a save reads back as the same game", () => {
  const random = seededRandom(3);
  const state = game.newGame(NOW, random);
  state.run.cookies = 1e15;
  state.run.baked = 2e15;
  for (let i = 0; i < BUILDINGS.length; i++) game.buyBuilding(state, i, 3);
  state.run.handmade = 1234.5;
  state.run.clicks = 99;
  game.refreshUnlocks(state);
  for (const upgrade of game.availableUpgrades(state).slice(0, 12)) game.buyUpgrade(state, upgrade.id);
  state.run.buffs.push(
    { kind: "building", building: MINE, left: 12.5, total: 30, cps: 1.3, click: 1 },
    frenzy(50),
  );
  state.run.golden = { x: 0.3, y: 0.7, age: 2, life: 13 };
  state.run.lastEffect = "lucky";
  state.run.free[CURSOR] = 10;
  Object.assign(state.legacy, { prestige: 12, chips: 5, bakedBefore: 1e15, ascensions: 2 });
  state.legacy.heavenly.add("oven-left-on");
  state.achievements.add("baked-1e0");
  state.achievements.add("how-could-you");
  state.settings = { numbers: "short", effects: false, bulk: 100 };
  Object.assign(state.totals, { newsClicks: 7, goldenMissed: 2, played: 3600.5 });
  assert.ok(state.run.upgrades.size >= 10 && game.totalOwned(state) > 20, "the save has something in it");

  const loaded = parseSave(serialize(state, NOW + 5000, "tab-a"), NOW + 10_000);
  assert.ok(loaded);
  assert.equal(loaded.savedAt, NOW + 5000);
  assert.equal(loaded.owner, "tab-a");
  const plain = (s: game.GameState) => JSON.parse(serialize(s, 0, ""));
  assert.deepEqual(plain(loaded.state), plain(state));

  const ascended = fresh();
  ascended.run.baked = 1e13;
  game.ascend(ascended, NOW);
  const reloaded = parseSave(serialize(ascended, NOW, ""), NOW)!.state;
  assert.equal(reloaded.legacy.ascending, true, "a reload in heaven stays in heaven");
});

await check("a damaged or foreign save never breaks the game", () => {
  for (const text of ["", "{", "null", "[]", "42", '"cookie"', '{"game":"other"}', "{}", "\u0000"]) {
    assert.equal(parseSave(text, NOW), null, JSON.stringify(text));
  }
  const weird = JSON.stringify({
    game: "cookie",
    version: 999,
    savedAt: "yesterday",
    owner: 5,
    run: {
      cookies: -5,
      baked: NaN,
      handmade: "lots",
      clicks: 1.7,
      startedAt: NOW * 2,
      buildings: { cursor: { owned: -1, free: 2.5, produced: Infinity }, grandma: { owned: 1e400 }, nope: { owned: 5 } },
      upgrades: ["grandma-1", "nope", 7],
      unlocked: null,
      buffs: [
        { kind: "frenzy", left: 1e9, cps: 1e9 },
        { kind: "frenzy", left: 5 },
        { kind: "building", building: "nope", left: 5 },
        { kind: "zap", left: 5 },
        "x",
        { kind: "click-frenzy", left: -1 },
      ],
      golden: { x: 5, y: -5, age: 100, life: 13 },
      nextGolden: -50,
      lastEffect: "boom",
    },
    legacy: { prestige: -3, chips: "9", heavenly: ["oven-left-on", "__proto__", "constructor"], ascending: "yes" },
    totals: null,
    achievements: ["baked-1e0", "made-up"],
    settings: { numbers: "tiny", effects: 0, bulk: 7 },
  });
  const loaded = parseSave(weird, NOW);
  assert.ok(loaded);
  const { state } = loaded;
  assert.equal(loaded.savedAt, NOW);
  assert.equal(loaded.owner, "");
  assert.equal(state.run.cookies, 0);
  assert.equal(state.run.baked, 0);
  assert.equal(state.run.handmade, 0);
  assert.equal(state.run.clicks, 1);
  assert.equal(state.run.startedAt, NOW, "a start in the future is now");
  assert.equal(state.run.owned[CURSOR], 0);
  assert.equal(state.run.free[CURSOR], 2);
  assert.equal(state.run.produced[CURSOR], 0);
  assert.equal(state.run.owned[GRANDMA], 0);
  assert.deepEqual([...state.run.upgrades], ["grandma-1"]);
  assert.deepEqual([...state.run.unlocked], ["grandma-1"], "anything bought was in the store");
  assert.deepEqual(state.run.buffs, [{ kind: "frenzy", building: -1, left: 86_400, total: 86_400, cps: 7, click: 1 }]);
  assert.equal(state.run.golden, null);
  assert.equal(state.run.nextGolden, 0);
  assert.equal(state.run.lastEffect, null);
  assert.deepEqual({ ...state.legacy, heavenly: [...state.legacy.heavenly] }, {
    prestige: 0,
    chips: 0,
    heavenly: ["oven-left-on"],
    bakedBefore: 0,
    ascensions: 0,
    ascending: false,
  });
  assert.deepEqual([...state.achievements], ["baked-1e0"]);
  assert.deepEqual(state.settings, { numbers: "long", effects: true, bulk: 1 });
  assert.deepEqual(state.totals, { clicks: 0, handmade: 0, goldenClicks: 0, goldenMissed: 0, newsClicks: 0, startedAt: NOW, played: 0 });

  // And it plays.
  game.clickCookie(state, 1);
  game.advance(state, 10, true);
  game.refreshUnlocks(state);
  game.checkAchievements(state, NOW);
  assert.ok(state.run.cookies >= 1);
});

await check("an export pastes back in, and so does the raw json", () => {
  const json = serialize(game.newGame(NOW), NOW, "x");
  const code = encodeExport(json);
  assert.match(code, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(decodeImport(code), json);
  assert.equal(decodeImport(`  ${code.slice(0, 20)}\n${code.slice(20)}\n`), json, "line breaks from pasting");
  assert.equal(decodeImport(json), json);
  assert.equal(decodeImport("not a save!"), null);
  const unicode = '{"game":"cookie","owner":"ñ 🍪"}';
  assert.equal(decodeImport(encodeExport(unicode)), unicode);
});

await check("numbers read the way the game writes them", () => {
  for (const [value, text] of [
    [0, "0"],
    [0.7, "0"],
    [1, "1"],
    [999_999, "999,999"],
    [1e6, "1 million"],
    [1_234_567, "1.235 million"],
    [999_999_999, "1 billion"],
    [1.5e9, "1.5 billion"],
    [1e33, "1 decillion"],
    [1.5e36, "1.5 undecillion"],
    [2e45, "2 quattuordecillion"],
    [1e63, "1 vigintillion"],
    [1e300, "1 novemnonagintillion"],
    [-2e6, "-2 million"],
    [Infinity, "infinity"],
    [NaN, "0"],
  ] as const) {
    assert.equal(formatNumber(value), text, String(value));
  }
  assert.equal(formatNumber(1.5e9, { short: true }), "1.5B");
  assert.equal(formatNumber(1e33, { short: true }), "1Dc");
  assert.equal(formatNumber(1e36, { short: true }), "1UnDc");
  assert.equal(formatNumber(0.1, { decimal: true }), "0.1");
  assert.equal(formatNumber(1234.56, { decimal: true }), "1,234.6");
  assert.match(formatNumber(1e303), /^1\.000e303$/);
  for (let power = 6; power < 303; power += 1) {
    const text = formatNumber(10 ** power);
    assert.ok(!/NaN|undefined|e\d/.test(text), `${power}: ${text}`);
  }
  assert.equal(formatClock(77), "1:17");
  assert.equal(formatClock(0.2), "0:01");
  assert.equal(formatClock(-3), "0:00");
  assert.equal(formatDuration(0), "0 seconds");
  assert.equal(formatDuration(1), "1 second");
  assert.equal(formatDuration(45), "45 seconds");
  assert.equal(formatDuration(61), "1 minute, 1 second");
  assert.equal(formatDuration(3605), "1 hour");
  assert.equal(formatDuration(3660), "1 hour, 1 minute");
  assert.equal(formatDuration(90_061), "1 day, 1 hour");
});

await check("the news only reports what could be true", () => {
  const start = { bakedAllTime: 0, owned: BUILDINGS.map(() => 0), goldenClicks: 0, ascensions: 0 };
  const random = seededRandom(5);
  const seen = new Set(Array.from({ length: 300 }, () => pickHeadline(start, random)));
  assert.ok(seen.size >= 5);
  for (const headline of seen) assert.ok(!/grandma|portal|time travel|golden/i.test(headline), headline);
  const current = [...seen][0];
  for (let i = 0; i < 50; i++) assert.notEqual(pickHeadline(start, random, current), current);
  const later = { ...start, bakedAllTime: 1e20, owned: BUILDINGS.map(() => 100) };
  assert.ok(Array.from({ length: 500 }, () => pickHeadline(later, random)).some((h) => /time travellers/i.test(h)));
});

await check("a bot plays a whole day without anything going wrong", () => {
  const random = seededRandom(11);
  let now = NOW;
  const state = game.newGame(now, random);
  const reached: Record<string, number> = {};

  const buyBest = () => {
    for (let bought = 0; bought < 50; bought++) {
      const made = game.production(state);
      let best = -1;
      let bestRatio = Infinity;
      for (let i = 0; i < BUILDINGS.length; i++) {
        if (!game.buildingVisible(state, i)) break;
        const gain = made.each[i] > 0 ? made.each[i] : BUILDINGS[i].cps;
        const ratio = game.buildingPrice(state, i) / gain;
        if (ratio < bestRatio) [best, bestRatio] = [i, ratio];
      }
      if (best < 0 || !game.buyBuilding(state, best)) return;
    }
  };

  const invariants = (second: number) => {
    const numbers = JSON.stringify(JSON.parse(serialize(state, now, "")), (_, value) => {
      if (typeof value === "number") assert.ok(Number.isFinite(value) && value >= 0, `at ${second}s: ${value}`);
      return value;
    });
    assert.ok(numbers.length > 0);
    for (const count of state.run.owned) assert.ok(Number.isInteger(count));
    const producedByBuildings = state.run.produced.reduce((a, b) => a + b, 0);
    assert.ok(producedByBuildings + state.run.handmade <= state.run.baked * (1 + 1e-9), `at ${second}s the books balance`);
    const loaded = parseSave(serialize(state, now, ""), now);
    assert.deepEqual(JSON.parse(serialize(loaded!.state, now, "")), JSON.parse(serialize(state, now, "")));
  };

  for (let second = 1; second <= 24 * 3600; second++) {
    now += 1000;
    if (second <= 1800) for (let c = 0; c < 6; c++) game.clickCookie(state, now + c * 100);
    game.advance(state, 1, true, random);
    if (state.run.golden) game.clickGolden(state, random);
    if (second % 5 === 0) {
      game.refreshUnlocks(state);
      for (const upgrade of game.availableUpgrades(state)) {
        if (!game.buyUpgrade(state, upgrade.id)) break;
      }
      buyBest();
      game.checkAchievements(state, now);
      state.notices.length = 0;
    }
    for (const milestone of [1e6, 1e9, 1e12, 1e15]) {
      if (state.run.baked >= milestone && !(milestone in reached)) reached[milestone] = second;
    }
    if (second % 3600 === 0) invariants(second);
  }

  const hours = (seconds: number) => (seconds / 3600).toFixed(1);
  console.log(
    `      the bot: ${formatNumber(state.run.baked)} baked, ${formatNumber(game.production(state).total)}/s, ` +
      `${game.totalOwned(state)} buildings, ${state.run.upgrades.size} upgrades, ${state.achievements.size} achievements, ` +
      `${state.totals.goldenClicks} golden; a million at ${hours(reached[1e6])}h, a billion at ${hours(reached[1e9])}h, ` +
      `a trillion at ${hours(reached[1e12] ?? NaN)}h`,
  );
  assert.ok(reached[1e6] < 3600, "a million within the first hour");
  assert.ok(reached[1e9] < 6 * 3600, "a billion within six hours");
  assert.ok(state.totals.goldenClicks > 100, "golden cookies keep coming");
  assert.ok(reached[1e12] < 24 * 3600, "a trillion within the day");
  assert.ok(state.run.upgrades.has("lucky-day") && state.run.upgrades.has("serendipity"));
  assert.ok(state.run.upgrades.has("kitten-helpers") && state.run.upgrades.has("kitten-workers"));
  assert.ok(state.achievements.size >= 40);
});

console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} checks passed`);
