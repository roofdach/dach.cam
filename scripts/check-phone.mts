/**
 * Checks for /phone: the chains and who has which when, timing, skips and
 * leavers, the reveal, and the API against memory and a pretend Upstash.
 * `npm run check` runs it after draw's.
 */

import assert from "node:assert/strict";

import type { Op } from "../lib/draw/ink.ts";
import {
  DEFAULT_SETTINGS,
  GRACE_MS,
  SPEEDS,
  albumOf,
  chainOf,
  cleanSettings,
  cleanText,
  fitDrawing,
  holder,
  isDrawing,
  phaseOf,
  reduce,
  stepKind,
  taskOf,
  viewOf,
  workFor,
  type PhoneEvent,
  type Work,
} from "../lib/phone/room.ts";
import { act, createRoom, getRoom, parseChainQuery, type Identity } from "../lib/phone/server/rooms.ts";
import { CODE_PATTERN } from "../lib/rooms/codes.ts";
import { RoomError } from "../lib/rooms/http.ts";
import { MemoryStore, UpstashStore, type RoomStore } from "../lib/rooms/store.ts";
import { fakeUpstash } from "./fake-upstash.mts";

const results: string[] = [];
async function check(name: string, body: () => void | Promise<void>) {
  await body();
  results.push(name);
}

const T0 = Date.UTC(2026, 8, 26, 12);
const fails = (status: number) => (e: unknown) => e instanceof RoomError && e.status === status;
const WRITE = SPEEDS.normal.write * 1000;
const DRAW = SPEEDS.normal.draw * 1000;

const create: PhoneEvent = { k: "create", t: T0, code: "BCDF", settings: DEFAULT_SETTINGS };
const join = (p: string, t = T0): PhoneEvent => ({ k: "join", t, p, name: p, tok: `tok-${p}` });
const submit = (p: string, step: number, work: Work, t: number, game = 1): PhoneEvent => ({ k: "submit", t, p, game, step, work });
const LINE: Op[] = [["l", 0, 12, 1, 10, 10, 200, 200]];

await check("what people write and draw is checked", () => {
  assert.deepEqual(cleanSettings({ speed: "quick" }), { speed: "quick" });
  assert.equal(cleanSettings({ speed: "toString" }), null);
  assert.equal(cleanSettings(null), null);
  assert.equal(cleanText("  a cat \n\u0000 in   a hat "), "a cat in a hat");
  assert.equal(cleanText("x".repeat(150))!.length, 100);
  assert.equal(cleanText("   "), null);
  assert.ok(isDrawing(LINE));
  assert.ok(!isDrawing([]) && !isDrawing([["l", 0, 99, 1, 1, 1]]) && !isDrawing("lines"));
});

await check("a drawing too big to send is thinned out until it fits", () => {
  const busy: Op[] = Array.from({ length: 30 }, (_, i) => ["l", i, 12, 1, ...Array.from({ length: 2400 }, (_, j) => (j * 37 + i) % 600)] as Op);
  assert.ok(JSON.stringify(busy).length > 200_000);
  const fitted = fitDrawing(busy)!;
  assert.ok(isDrawing(fitted) && JSON.stringify(fitted).length < 200_000);
  assert.equal(fitted.length, 30, "every stroke is still there");
  assert.deepEqual(fitted[0].slice(-2), busy[0].slice(-2), "lines keep their ends");
  assert.deepEqual(fitDrawing(LINE), LINE, "a small drawing is left alone");
  assert.equal(fitDrawing([["l", 0, 12, 1, 5, 5], ["u", 0]]), null, "nothing showing, nothing to hand in");
});

await check("chains pass round the table, writing then drawing then describing", () => {
  const room = reduce([create, join("a"), join("b"), join("c"), { k: "start", t: T0, p: "a" }], T0)!;
  const game = room.game!;
  assert.deepEqual([0, 1, 2, 3].map(stepKind), ["write", "draw", "describe", "draw"]);
  assert.deepEqual(["a", "b", "c"].map((p) => chainOf(game, p, 0)), [0, 1, 2], "everyone starts their own");
  assert.deepEqual(["a", "b", "c"].map((p) => chainOf(game, p, 1)), [2, 0, 1], "then takes the one from the seat before");
  assert.equal(holder(game, 0, 1), "b");
  assert.equal(chainOf(game, "z", 0), -1);
});

await check("a game plays through: each step ends when everyone's in, and the reveal starts", () => {
  const events: PhoneEvent[] = [create, join("a"), join("b"), join("c"), { k: "start", t: T0, p: "a" }];
  let room = reduce(events, T0)!;
  assert.equal(phaseOf(room), "playing");
  assert.deepEqual(taskOf(room.game!, "a"), { chain: 0, kind: "write", from: null });
  events.push(submit("a", 0, "text", T0 + 1000), submit("b", 0, "text", T0 + 2000));
  events.push(submit("b", 0, "text", T0 + 2500), submit("a", 0, "drawing", T0 + 2500));
  room = reduce(events, T0 + 3000)!;
  assert.equal(room.game!.step, 0, "c is still writing; a second go and the wrong kind of work don't count");
  assert.deepEqual(viewOf(room, T0 + 3000).game!.handed, ["a", "b"]);
  events.push(submit("c", 0, "text", T0 + 4000));
  room = reduce(events, T0 + 4000)!;
  assert.equal(room.game!.step, 1, "all in, so the next step starts at once");
  assert.equal(room.game!.stepEnd, T0 + 4000 + DRAW);
  assert.deepEqual(taskOf(room.game!, "b"), { chain: 0, kind: "draw", from: 0 });
  for (const [step, work] of [[1, "drawing"], [2, "text"]] as const) {
    for (const p of ["a", "b", "c"]) events.push(submit(p, step, work, T0 + 5000 + step));
  }
  room = reduce(events, T0 + 6000)!;
  assert.equal(phaseOf(room), "reveal");
  const album = albumOf(room.game!);
  assert.deepEqual(album[0].entries.map((e) => [e.p, e.work]), [["a", "text"], ["b", "drawing"], ["c", "text"]]);
  assert.deepEqual(album[2].entries.map((e) => e.p), ["c", "a", "b"]);
  assert.equal(room.game!.shown, 1, "the first chain's first step shows straight away");
  assert.equal(viewOf(room, T0 + 6000).game!.album!.length, 3);
});

await check("time runs out, late work is turned away, and a skipped step doesn't break the chain", () => {
  const events: PhoneEvent[] = [create, join("a"), join("b"), join("c"), { k: "start", t: T0, p: "a" }];
  events.push(submit("a", 0, "text", T0 + 1000), submit("c", 0, "text", T0 + WRITE + GRACE_MS - 1));
  let room = reduce(events, T0 + WRITE + GRACE_MS - 1)!;
  assert.equal(room.game!.step, 0, "sent as the clock ran out still counts, and b could still make it");
  room = reduce(events, T0 + WRITE + GRACE_MS)!;
  assert.equal(room.game!.step, 1, "time's up");
  events.push(submit("b", 0, "text", T0 + WRITE + GRACE_MS + 10));
  room = reduce(events, T0 + WRITE + GRACE_MS + 10)!;
  assert.equal(room.game!.handed[0].has("b"), false, "too late");
  // b never wrote, so whoever gets b's chain starts it instead of drawing nothing.
  assert.deepEqual(taskOf(room.game!, "c"), { chain: 1, kind: "write", from: null });
  assert.deepEqual(taskOf(room.game!, "b"), { chain: 0, kind: "draw", from: 0 });
});

await check("leavers are skipped, the host's clicks drive the reveal, and a new game can start", () => {
  const events: PhoneEvent[] = [create, join("a"), join("b"), join("c"), { k: "start", t: T0, p: "a" }];
  events.push(submit("a", 0, "text", T0 + 1000), submit("b", 0, "text", T0 + 1000), { k: "leave", t: T0 + 2000, p: "c", why: "left" });
  let room = reduce(events, T0 + 2000)!;
  assert.equal(room.game!.step, 1, "nobody waits for someone who's gone");
  assert.deepEqual(viewOf(room, T0 + 2000).players.map((p) => [p.id, p.active]), [["a", true], ["b", true], ["c", false]], "their work stays, so they stay listed");
  assert.equal(taskOf(room.game!, "a")!.kind, "write", "c never wrote, so a starts c's chain");
  for (const step of [1, 2]) {
    const game = reduce(events, T0 + 3000 + step)!.game!;
    for (const p of ["a", "b"]) events.push(submit(p, step, workFor(taskOf(game, p)!.kind), T0 + 3000 + step));
  }
  room = reduce(events, T0 + 4000)!;
  assert.equal(phaseOf(room), "reveal");
  const total = albumOf(room.game!).reduce((n, chain) => n + chain.entries.length, 0);
  assert.equal(total, 6);
  events.push({ k: "show", t: T0 + 5000, p: "b", game: 1, n: 2 }, { k: "show", t: T0 + 5000, p: "a", game: 1, n: 3 });
  assert.equal(reduce(events, T0 + 5000)!.game!.shown, 1, "only the host, one step at a time");
  events.push({ k: "show", t: T0 + 5000, p: "a", game: 1, n: 2 }, { k: "show", t: T0 + 5000, p: "a", game: 1, n: 2 });
  assert.equal(reduce(events, T0 + 5000)!.game!.shown, 2, "a double click moves on once");
  events.push(join("d", T0 + 6000), { k: "start", t: T0 + 7000, p: "a" });
  room = reduce(events, T0 + 7000)!;
  assert.equal(room.game!.index, 2);
  assert.deepEqual(room.game!.order, ["a", "b", "d"], "a new game takes whoever's here");
});

await check("someone arriving mid-game watches and plays the next one", () => {
  const room = reduce([create, join("a"), join("b"), { k: "start", t: T0, p: "a" }, join("c", T0 + 10)], T0 + 10)!;
  assert.equal(taskOf(room.game!, "c"), null);
  assert.deepEqual(room.game!.order, ["a", "b"]);
});

/* ------------------------------------------------------------- service */

async function playThrough(store: RoomStore<PhoneEvent>, clock: { now: number }) {
  const created = await createRoom(store, { name: "ann" }, clock.now);
  const code = created.room.code;
  assert.match(code, CODE_PATTERN);
  const ann = created.you!;
  const ben = (await act(store, code.toLowerCase(), { type: "join", name: "ben" }, clock.now)).you!;
  const cat = (await act(store, code, { type: "join", name: "cat" }, clock.now)).you!;
  const as = (who: Identity, body: Record<string, unknown>) => act(store, code, { ...body, player: who.id, token: who.token }, clock.now);

  await assert.rejects(as(ben, { type: "start" }), fails(403));
  let reply = await as(ann, { type: "settings", settings: { speed: "quick" } });
  assert.equal(reply.room.settings.speed, "quick");
  reply = await as(ann, { type: "start" });
  assert.deepEqual(reply.mine!.task, { chain: 0, kind: "write", from: null });

  await assert.rejects(as(ann, { type: "submit", game: 1, step: 0, text: "  " }), fails(400));
  await assert.rejects(as(ann, { type: "submit", game: 1, step: 1, text: "early" }), fails(409));
  await as(ann, { type: "submit", game: 1, step: 0, text: "a cat in a hat" });
  await assert.rejects(as(ann, { type: "submit", game: 1, step: 0, text: "again" }), fails(409));
  await as(ben, { type: "submit", game: 1, step: 0, text: "a dog on a log" });
  reply = await as(cat, { type: "submit", game: 1, step: 0, text: "a frog in fog" });
  assert.equal(reply.room.game!.step, 1);
  // Cat carries on ben's chain, and gets ben's words to draw, and nobody else's.
  assert.deepEqual(reply.mine!.task, { chain: 1, kind: "draw", from: 0 });
  assert.deepEqual(reply.mine!.prompt, { step: 0, p: ben.id, text: "a dog on a log" });
  assert.ok(!JSON.stringify(await getRoom(store, code, clock.now)).includes("a dog on a log"), "nobody else can read it");

  await assert.rejects(as(cat, { type: "submit", game: 1, step: 1, text: "words" }), fails(400), "a drawing step wants a drawing");
  await assert.rejects(as(cat, { type: "submit", game: 1, step: 1, ops: [["l", 0, 99, 1, 1, 1]] }), fails(400));
  const huge: Op[] = Array.from({ length: 20 }, (_, i) => ["l", i, 12, 1, ...Array.from({ length: 3998 }, (_, j) => (j * 37 + i) % 600)] as Op);
  await assert.rejects(as(cat, { type: "submit", game: 1, step: 1, ops: huge }), fails(413));
  // Undone strokes don't travel.
  await as(cat, { type: "submit", game: 1, step: 1, ops: [...LINE, ["l", 1, 2, 3, 5, 5, 9, 9], ["u", 1]] });
  await as(ann, { type: "submit", game: 1, step: 1, ops: LINE });
  reply = await as(ben, { type: "submit", game: 1, step: 1, ops: LINE });
  assert.equal(reply.room.game!.step, 2);
  const describe = (await as(ann, { type: "me" })).mine!;
  assert.equal(describe.task!.kind, "describe");
  assert.deepEqual(describe.prompt, { step: 1, p: cat.id, ops: LINE }, "ann describes cat's drawing of ben's words");

  for (const who of [ann, ben, cat]) reply = await as(who, { type: "submit", game: 1, step: 2, text: `said by ${who.id}` });
  assert.equal(reply.room.game!.phase, "reveal");
  const view = await getRoom(store, code, clock.now, { game: 1, chain: 1 });
  assert.deepEqual(
    view.chain!.entries.map((e) => ("text" in e ? e.text : "drawing")),
    ["a dog on a log", "drawing", `said by ${ann.id}`],
  );
  assert.equal((await getRoom(store, code, clock.now, { game: 9, chain: 1 })).chain, null);

  await assert.rejects(as(ben, { type: "show", game: 1, n: 2 }), fails(403));
  reply = await as(ann, { type: "show", game: 1, n: 2 });
  assert.equal(reply.room.game!.shown, 2);
  await assert.rejects(as(ann, { type: "show", game: 1, n: 2 }), fails(409));
  reply = await as(ann, { type: "start" });
  assert.equal(reply.room.game!.index, 2);
  await assert.rejects(getRoom(store, "ZZZZ", clock.now), fails(404));
  return code;
}

await check("the phone API plays a game through, in memory", async () => {
  const clock = { now: T0 };
  const store = new MemoryStore<PhoneEvent>(() => clock.now);
  await playThrough(store, clock);
});

await check("the same game plays through Upstash's REST protocol, with each chain beside the log", async () => {
  const upstash = await fakeUpstash("secret");
  try {
    const clock = { now: T0 };
    const code = await playThrough(new UpstashStore<PhoneEvent>(upstash.url, "secret", "phone"), clock);
    for (const chain of [0, 1, 2]) {
      const key = `phone:room:${code}:chain:1.${chain}`;
      assert.equal(upstash.lists.get(key)!.length, 3);
      assert.equal(upstash.ttls.get(key), 6 * 60 * 60, `${key} expires`);
    }
  } finally {
    await upstash.close();
  }
});

await check("a chain is asked for by game and number", () => {
  assert.deepEqual(parseChainQuery("2.11"), { game: 2, chain: 11 });
  assert.equal(parseChainQuery(null), undefined);
  assert.equal(parseChainQuery("2"), undefined);
  assert.equal(parseChainQuery("2.123"), undefined);
});

console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} phone checks passed`);
