/**
 * Checks for /shape: the country data, what typing a name finds, the hints,
 * the daily, the quiz, and the race from its rules down to the API against
 * memory and a pretend Upstash. `npm run check` runs it after phone's.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import {
  BY_CODE,
  MAX_GUESSES,
  TARGETS,
  bearing,
  dailyAnswer,
  dailyNumber,
  findCountry,
  hintFor,
  msUntilNextDaily,
  normalize,
  quiz,
  quizPoints,
  shareText,
  squares,
  suggest,
} from "../lib/shape/game.ts";
import { COUNTRIES } from "../lib/shape/data.ts";
import { COUNTDOWN_MS, DEFAULT_SETTINGS, REVEAL_MS, pointsFor, privateView, reduce, viewOf, type ShapeEvent } from "../lib/shape/room.ts";
import { act, createRoom, getRoom, type Identity } from "../lib/shape/server/rooms.ts";
import { CODE_PATTERN } from "../lib/rooms/codes.ts";
import { RoomError } from "../lib/rooms/http.ts";
import { MemoryStore, UpstashStore, type RoomStore } from "../lib/rooms/store.ts";
import { fakeUpstash } from "./fake-upstash.mts";

const results: string[] = [];
async function check(name: string, body: () => void | Promise<void>) {
  await body();
  results.push(name);
}

const T0 = Date.UTC(2026, 8, 27, 12);
const fails = (status: number) => (e: unknown) => e instanceof RoomError && e.status === status;
const country = (code: string) => BY_CODE.get(code)!;

await check("every country has a shape, a name, and what a quiz needs", () => {
  assert.ok(COUNTRIES.length >= 200, `${COUNTRIES.length} countries`);
  assert.ok(TARGETS.length >= 150, `${TARGETS.length} to guess`);
  assert.equal(new Set(COUNTRIES.map((c) => c.code)).size, COUNTRIES.length);
  assert.equal(new Set(COUNTRIES.map((c) => normalize(c.name))).size, COUNTRIES.length, "no two share a name");
  for (const c of TARGETS) {
    assert.match(c.path, /^M\d+ \d+l/, `${c.code} has an outline`);
    assert.ok(c.w > 0 && c.h > 0 && c.w <= 1000 && c.h <= 1000);
  }
  for (const c of COUNTRIES) if (c.flag) assert.ok(existsSync(`public/flags/${c.code.toLowerCase()}.svg`), `${c.code}'s flag is there`);
  assert.deepEqual(["FR", "JP", "AU", "US", "IE"].map((c) => country(c).capital), ["Paris", "Tokyo", "Canberra", "Washington, D.C.", "Dublin"]);
  assert.ok(country("FR").neighbours.includes("DE") && country("FR").neighbours.includes("ES"));
  assert.deepEqual(country("GB").neighbours, ["IE"]);
  assert.deepEqual(country("JP").neighbours, [], "islands border nobody");
  assert.ok(country("CY").target && country("SO").target, "Cyprus and Somalia are whole");
  assert.equal(country("AQ" as string), undefined, "no Antarctica");
});

await check("names are found however they're typed, and each means one country", () => {
  for (const c of COUNTRIES) for (const name of [c.name, ...c.aliases]) assert.equal(findCountry(name)?.code, c.code, `"${name}" means ${c.name}`);
  assert.equal(findCountry("congo")?.code, "CG", "Congo is the Republic of the Congo, not the DR Congo too");
  assert.equal(findCountry("drc")?.code, "CD");
  assert.equal(findCountry("usa")?.code, "US");
  assert.equal(findCountry("  United States of America ")?.code, "US");
  assert.equal(findCountry("UK")?.code, "GB");
  assert.equal(findCountry("Czech Republic")?.code, "CZ");
  assert.equal(findCountry("côte d'ivoire")?.code, "CI");
  assert.equal(findCountry("the netherlands")?.code, "NL");
  assert.equal(findCountry("niger")?.code, "NE", "Niger isn't Nigeria");
  assert.equal(findCountry("atlantis"), null);
  assert.deepEqual(suggest("kor").map((c) => c.code).sort(), ["KP", "KR"]);
  assert.equal(suggest("fra")[0].code, "FR", "names that start with it come first");
  const united = suggest("united", 10).map((c) => c.code);
  assert.ok(["US", "GB", "AE"].every((c) => united.includes(c)));
  assert.ok(!suggest("fra", 6, new Set(["FR"])).some((c) => c.code === "FR"), "no suggesting what's been guessed");
});

await check("a wrong guess says how far and which way; squares and shares read right", () => {
  const h = hintFor(country("FR"), country("DE"));
  assert.ok(h.km > 500 && h.km < 1000, `${h.km} km`);
  assert.equal(h.direction, 1, "Germany is north-east of France");
  assert.equal(hintFor(country("DE"), country("DE")).proximity, 100);
  assert.ok(hintFor(country("ES"), country("NZ")).proximity < 5, "the far side of the world is far");
  assert.ok(hintFor(country("BE"), country("NL")).proximity > hintFor(country("PT"), country("NL")).proximity);
  assert.ok(Math.abs(bearing(0, 0, 10, 0)) < 0.001, "due north is 0");
  assert.equal(squares(100), "🟩🟩🟩🟩🟩");
  assert.equal(squares(55), "🟩🟩🟨⬜⬜");
  assert.equal(squares(0), "⬜⬜⬜⬜⬜");
  const text = shareText("shape #3", [hintFor(country("PT"), country("FR")), hintFor(country("FR"), country("FR"))], true, "dach.cam/shape");
  assert.match(text, /^shape #3 2\/6\n[🟩🟨⬜]{5}↗️\n🟩🟩🟩🟩🟩🎉\ndach\.cam\/shape$/u);
  assert.match(shareText("shape #3", [], false, "x"), /^shape #3 X\/6/);
});

await check("the daily is the same for everyone and goes round every country before repeating", () => {
  assert.equal(dailyNumber("2026-09-26"), 1);
  assert.equal(dailyNumber("2026-10-26"), 31);
  assert.equal(dailyAnswer("2026-10-01").code, dailyAnswer("2026-10-01").code);
  const days = Array.from({ length: TARGETS.length }, (_, i) => dailyAnswer(new Date(Date.UTC(2026, 8, 27 + i)).toISOString().slice(0, 10)).code);
  assert.equal(new Set(days).size, TARGETS.length, "a whole cycle without repeats");
  const wait = msUntilNextDaily(Date.UTC(2026, 8, 27, 23, 0));
  assert.equal(wait, 60 * 60 * 1000);
});

await check("a quiz asks about real flags, capitals and borders, with wrong answers from nearby", () => {
  const rounds = quiz("seed");
  assert.equal(rounds.length, 5);
  assert.deepEqual(quiz("seed"), rounds, "a seed makes the same quiz");
  for (const r of rounds) {
    const answer = country(r.answer);
    assert.equal(new Set(r.flags).size, 4);
    assert.ok(r.flags.includes(r.answer));
    assert.ok(r.capitals!.includes(answer.capital!) && new Set(r.capitals).size === 4);
    if (r.neighbours) {
      assert.ok(r.neighbours.correct.every((c) => answer.neighbours.includes(c) && r.neighbours!.options.includes(c)));
      assert.ok(r.neighbours.options.filter((c) => !r.neighbours!.correct.includes(c)).every((c) => !answer.neighbours.includes(c)));
    }
  }
  assert.equal(quizPoints(1, true, true, true), 6);
  assert.equal(quizPoints(3, false, null, null), 1);
  assert.equal(quizPoints(null, true, false, null), 1);
});

/* ---------------------------------------------------------------- race */

const create: ShapeEvent = { k: "create", t: T0, code: "BCDF", salt: "salt", settings: { rounds: 5, time: 20 } };
const join = (p: string, t = T0): ShapeEvent => ({ k: "join", t, p, name: p, tok: `tok-${p}` });

await check("a race: a countdown, the same shape for all, speed scores, early ends, a reveal, the end", () => {
  const events: ShapeEvent[] = [create, join("a"), join("b"), { k: "start", t: T0, p: "a" }];
  let room = reduce(events, T0 + 1000)!;
  assert.equal(room.game!.phase, "countdown");
  assert.equal(viewOf(room, T0 + 1000).game!.shape, null, "nothing to see before it starts");
  const start = T0 + COUNTDOWN_MS;
  room = reduce(events, start)!;
  assert.equal(room.game!.phase, "playing");
  const target = room.game!.targets[0];
  const wrong = target === "FR" ? "DE" : "FR";
  const view = viewOf(room, start);
  assert.ok(view.game!.shape);
  assert.ok(!JSON.stringify(view).includes(`"${target}"`) && !JSON.stringify(view).includes(country(target).name), "the view never says what it is");
  events.push({ k: "guess", t: start + 2000, p: "a", game: 1, round: 0, c: wrong });
  events.push({ k: "guess", t: start + 2500, p: "a", game: 1, round: 0, c: wrong });
  events.push({ k: "guess", t: start + 5000, p: "b", game: 1, round: 0, c: target });
  room = reduce(events, start + 5000)!;
  assert.equal(viewOf(room, start + 5000).game!.tries.a, 1, "a repeat doesn't count");
  assert.deepEqual(privateView(room, "a")!.hints.map((h) => h.code), [wrong]);
  assert.equal(room.game!.scores.get("b"), pointsFor(0.75, 0));
  assert.equal(room.game!.phase, "playing", "a's still going");
  events.push({ k: "guess", t: start + 10_000, p: "a", game: 1, round: 0, c: target });
  room = reduce(events, start + 10_000)!;
  assert.equal(room.game!.phase, "reveal", "everyone has it");
  assert.equal(room.game!.scores.get("a"), pointsFor(0.5, 1));
  assert.equal(viewOf(room, start + 10_000).game!.answer, target);
  room = reduce(events, start + 10_000 + REVEAL_MS)!;
  assert.equal(room.game!.round, 1);
  assert.equal(room.game!.phase, "playing");
  // Nobody guesses the rest: four rounds of twenty seconds and a reveal each.
  room = reduce(events, start + 10_000 + REVEAL_MS + 4 * (20_000 + REVEAL_MS) - 1)!;
  assert.equal(room.game!.phase, "reveal");
  room = reduce(events, start + 10_000 + REVEAL_MS + 4 * (20_000 + REVEAL_MS))!;
  assert.equal(room.game!.phase, "final");
  assert.equal(viewOf(room, 0).game!.past.length, 5);
});

await check("six wrong goes and you're out; leaving and joining mid-race keep it moving", () => {
  const events: ShapeEvent[] = [create, join("a"), join("b"), { k: "start", t: T0, p: "a" }];
  const start = T0 + COUNTDOWN_MS;
  const target = reduce(events, start)!.game!.targets[0];
  const wrongs = TARGETS.map((c) => c.code).filter((c) => c !== target).slice(0, MAX_GUESSES + 1);
  wrongs.forEach((c, i) => events.push({ k: "guess", t: start + 100 * (i + 1), p: "a", game: 1, round: 0, c }));
  let room = reduce(events, start + 1000)!;
  assert.equal(room.game!.guesses[0].get("a")!.length, MAX_GUESSES);
  events.push({ k: "leave", t: start + 2000, p: "b", why: "left" });
  room = reduce(events, start + 2000)!;
  assert.equal(room.game!.phase, "reveal", "a's out of goes and b's gone: nobody's still trying");
  events.push(join("c", start + 3000));
  room = reduce(events, start + 3000 + REVEAL_MS)!;
  assert.ok(room.players.get("c")!.active);
  assert.equal(room.game!.round, 1);
  assert.equal(pointsFor(1, 0), 1000);
  assert.equal(pointsFor(0, 5), 100, "never less than 100 for getting it");
});

async function playThrough(store: RoomStore<ShapeEvent>, clock: { now: number }) {
  const created = await createRoom(store, { name: "ann" }, clock.now);
  const code = created.room.code;
  assert.match(code, CODE_PATTERN);
  const ann = created.you!;
  const ben = (await act(store, code.toLowerCase(), { type: "join", name: "ben" }, clock.now)).you!;
  const as = (who: Identity, body: Record<string, unknown>) => act(store, code, { ...body, player: who.id, token: who.token }, clock.now);
  await assert.rejects(as(ben, { type: "start" }), fails(403));
  await as(ann, { type: "settings", settings: { rounds: 5, time: 30 } });
  assert.equal((await getRoom(store, code, clock.now)).settings.time, 30);
  await as(ann, { type: "start" });
  await assert.rejects(as(ben, { type: "guess", game: 1, round: 0, c: "FR" }), fails(409), "not during the countdown");
  clock.now += COUNTDOWN_MS;
  const view = await getRoom(store, code, clock.now);
  assert.equal(view.game!.phase, "playing");
  // The answer's only known to the server; find it by trying every country from a third seat.
  const cat = (await act(store, code, { type: "join", name: "cat" }, clock.now)).you!;
  await assert.rejects(as(ben, { type: "guess", game: 1, round: 0, c: "XX" }), fails(400));
  let reply = await as(ben, { type: "guess", game: 1, round: 0, c: "FR" });
  assert.equal(reply.mine!.hints.length, 1);
  const hint = reply.mine!.hints[0];
  const answer = hint.proximity === 100 ? "FR" : TARGETS.find((c) => hintFor(country("FR"), c).km === hint.km && hintFor(country("FR"), c).direction === hint.direction)!.code;
  reply = await as(ann, { type: "guess", game: 1, round: 0, c: answer });
  assert.equal(reply.mine!.solved, true);
  assert.ok(reply.room.game!.solved.some((s) => s.p === ann.id));
  assert.equal((await as(ben, { type: "me" })).mine!.hints[0].code, "FR", "your goes come back after a reload");
  await as(cat, { type: "leave" });
  await as(ben, { type: "guess", game: 1, round: 0, c: answer === "FR" ? "DE" : answer });
  const after = await getRoom(store, code, clock.now);
  assert.equal(after.game!.phase, "reveal");
  assert.equal(after.game!.answer, answer);
  await assert.rejects(getRoom(store, "ZZZZ", clock.now), fails(404));
  return code;
}

await check("the race API plays a round through, in memory", async () => {
  const clock = { now: T0 };
  await playThrough(new MemoryStore<ShapeEvent>(() => clock.now), clock);
});

await check("and through Upstash's REST protocol", async () => {
  const upstash = await fakeUpstash("secret");
  try {
    const clock = { now: T0 };
    const code = await playThrough(new UpstashStore<ShapeEvent>(upstash.url, "secret", "shape"), clock);
    assert.ok(upstash.lists.get(`shape:room:${code}:log`)!.length > 5);
  } finally {
    await upstash.close();
  }
});

assert.deepEqual(DEFAULT_SETTINGS, { rounds: 10, time: 30 });
console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} shape checks passed`);
