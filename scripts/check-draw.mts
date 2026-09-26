/**
 * Checks for /draw: the words, how guesses are compared, the drawing's
 * operations, the replay rules of a room, and the API against memory and a
 * pretend Upstash. `npm run check` runs it after geo's.
 */

import assert from "node:assert/strict";

import { HEIGHT, MAX_BATCHES_PER_TURN, WIDTH, floodFill, isBatch, isOp, lastStroke, nextStroke, visible, type Op } from "../lib/draw/ink.ts";
import {
  CHOOSE_MS,
  DEFAULT_SETTINGS,
  GONE_MS,
  MAX_PLAYERS,
  REVEAL_MS,
  cleanSettings,
  hintPositions,
  phaseOf,
  privateView,
  reduce,
  viewOf,
  type DrawEvent,
  type Settings,
} from "../lib/draw/room.ts";
import { act, cleanMessage, createRoom, draw, getRoom, parseInkQuery, ping, type Identity } from "../lib/draw/server/rooms.ts";
import { turnKey, unseal } from "../lib/draw/secret.ts";
import { cleanWord, editDistance, isClose, maskWord, mentions, normalize, sameWord } from "../lib/draw/text.ts";
import { WORDS } from "../lib/draw/words.ts";
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

const create = (settings: Partial<Settings> = {}): DrawEvent => ({ k: "create", t: T0, code: "BCDF", salt: "salt", settings: { ...DEFAULT_SETTINGS, ...settings } });
const join = (p: string, t = T0): DrawEvent => ({ k: "join", t, p, name: p, tok: `tok-${p}` });
const start = (p: string, t = T0): DrawEvent => ({ k: "start", t, p });

/* --------------------------------------------------------------- words */

await check("the words are many, tidy and different", () => {
  assert.ok(WORDS.length >= 300, `${WORDS.length} words`);
  assert.equal(new Set(WORDS).size, WORDS.length, "no word twice");
  for (const word of WORDS) assert.equal(cleanWord(word), word, `"${word}" is as a host's word would be kept`);
});

await check("guesses match however they're typed, and near misses are spotted", () => {
  assert.equal(normalize("  Hello,   World! "), "hello world");
  assert.ok(sameWord("Ice-Cream", "ice cream"));
  assert.ok(sameWord("  icecream ", "ice cream"));
  assert.ok(sameWord("Crème Brûlée", "creme brulee"));
  assert.ok(!sameWord("ice", "ice cream"));
  assert.ok(!sameWord("", "!!"), "a word with nothing to match matches nothing");
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.ok(isClose("elephnt", "elephant") && isClose("elephantt", "elephant") && isClose("elepxant", "elephant"));
  assert.ok(!isClose("elephant", "elephant"), "right isn't close");
  assert.ok(!isClose("elefant", "elephant"), "two slips isn't close");
  assert.ok(!isClose("cat", "car"), "short words don't get hints for one letter");
  assert.ok(mentions("i think it's a CAT lol", "cat"));
  assert.ok(!mentions("i want it", "ant"), "a short word inside another doesn't count");
  assert.ok(mentions("icecreamyum", "ice cream"));
  assert.equal(maskWord("ice cream", new Set()), "___ _____");
  assert.equal(maskWord("t-shirt", new Set([0])), "t-_____");
  assert.equal(cleanMessage("  hi \u0000there\n  you "), "hi there you");
  assert.equal(cleanMessage("x".repeat(150))!.length, 100);
  assert.equal(cleanMessage(" \n "), null);
});

/* ----------------------------------------------------------------- ink */

await check("drawing operations are checked before they're kept", () => {
  assert.ok(isOp(["l", 0, 12, 1, 10, 10]) && isOp(["l", 3, 0, 3, 0, 0, WIDTH, HEIGHT]));
  assert.ok(!isOp(["l", 0, 12, 1, 10]), "points come in pairs");
  assert.ok(!isOp(["l", 0, 24, 1, 10, 10]), "a colour off the palette");
  assert.ok(!isOp(["l", 0, 12, 4, 10, 10]), "a brush that doesn't exist");
  assert.ok(!isOp(["l", 0, 12, 1, WIDTH + 1, 10]), "off the board");
  assert.ok(!isOp(["l", 0, 12, 1, 1.5, 10]), "whole numbers only");
  assert.ok(isOp(["f", 1, 2, 400, 300]) && !isOp(["f", 1, 2, 400]));
  assert.ok(isOp(["c", 2]) && isOp(["u", 1]));
  assert.ok(!isOp(["u"]) && !isOp(["x", 1]) && !isOp("l") && !isOp([]));
  assert.ok(isBatch([["c", 1]]) && !isBatch([]) && !isBatch(Array(121).fill(["c", 1])));
  assert.ok(!isBatch([["l", 0, 0, 0, ...Array(6002).fill(1)]]), "too many points for one request");
});

await check("an undo takes back its stroke once, however often it arrives", () => {
  const ops: Op[] = [["l", 0, 12, 1, 1, 1, 2, 2], ["l", 0, 12, 1, 2, 2, 3, 3], ["f", 1, 2, 5, 5], ["u", 1], ["u", 1]];
  assert.deepEqual(visible(ops), ops.slice(0, 2));
  assert.equal(lastStroke(ops), 0);
  assert.equal(nextStroke(ops), 2, "an undone stroke's number isn't used again");
  assert.equal(lastStroke([]), null);
  assert.deepEqual(visible([["l", 0, 12, 1, 1, 1], ["c", 1], ["u", 1]]), [["l", 0, 12, 1, 1, 1]], "undoing a clear brings the drawing back");
});

await check("the paint bucket fills up to the lines and no further", () => {
  const w = 20;
  const h = 10;
  const pixels = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) pixels.fill(0, (y * w + 10) * 4, (y * w + 10) * 4 + 3);
  const at = (x: number, y: number) => [...pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
  floodFill(pixels, w, h, 2, 2, "#ef130b");
  assert.deepEqual(at(0, 0), [0xef, 0x13, 0x0b]);
  assert.deepEqual(at(9, 9), [0xef, 0x13, 0x0b]);
  assert.deepEqual(at(10, 5), [0, 0, 0], "the line stays");
  assert.deepEqual(at(11, 5), [255, 255, 255], "the other side stays");
  const before = [...pixels];
  floodFill(pixels, w, h, 2, 2, "#ef130b");
  assert.deepEqual([...pixels], before, "filling with the colour that's there changes nothing");
});

/* ---------------------------------------------------------------- room */

await check("a game goes round everyone, scores guesses by speed, and ends", () => {
  const events: DrawEvent[] = [create({ rounds: 2, time: 60 }), join("a"), join("b"), join("c"), start("a", T0 + 1000)];
  let room = reduce(events, T0 + 1000)!;
  assert.equal(phaseOf(room), "choosing");
  const turn = room.game!.turn!;
  assert.equal(turn.drawer, "a");
  assert.equal(new Set(turn.options).size, 3);
  assert.deepEqual(reduce(events, T0 + 2000)!.game!.turn!.options, turn.options, "the words on offer don't change");
  assert.deepEqual(privateView(room, "a").options, turn.options);
  assert.equal(privateView(room, "b").options, null, "only the drawer sees the choice");

  events.push({ k: "choose", t: T0 + 3000, p: "a", turn: turn.id, i: 1 });
  room = reduce(events, T0 + 3000)!;
  const word = turn.options[1];
  assert.equal(phaseOf(room), "drawing");
  const view = viewOf(room, T0 + 3000);
  assert.equal(view.game!.turn!.word, null);
  assert.equal(view.game!.turn!.mask, maskWord(word, new Set()));
  assert.equal(privateView(room, "a").word, word);
  assert.equal(privateView(room, "b").word, null);

  // A quarter of the way in: three quarters of the time left.
  events.push({ k: "guess", t: T0 + 18_000, p: "b", turn: turn.id });
  events.push({ k: "guess", t: T0 + 19_000, p: "b", turn: turn.id }, { k: "guess", t: T0 + 19_000, p: "a", turn: turn.id });
  room = reduce(events, T0 + 19_000)!;
  assert.equal(room.game!.scores.get("b"), 388);
  assert.equal(room.game!.scores.get("a") ?? 0, 0, "the drawer can't guess their own word");
  assert.equal(privateView(room, "b").word, word, "once you've got it, you see it");
  assert.equal(phaseOf(room), "drawing", "c is still guessing");

  events.push({ k: "guess", t: T0 + 33_000, p: "c", turn: turn.id });
  room = reduce(events, T0 + 33_000)!;
  assert.equal(phaseOf(room), "reveal", "everyone has it, so the drawing stops");
  assert.equal(room.game!.scores.get("c"), 275);
  assert.equal(room.game!.scores.get("a"), 400, "the drawer scores for everyone getting it");
  const reveal = viewOf(room, T0 + 33_000).game!.turn!;
  assert.equal(reveal.word, word);
  assert.deepEqual(reveal.gained, { b: 388, c: 275, a: 400 });

  room = reduce(events, T0 + 33_000 + REVEAL_MS)!;
  assert.equal(room.game!.turn!.drawer, "b");
  assert.equal(phaseOf(room), "choosing");
  room = reduce(events, T0 + 33_000 + REVEAL_MS + CHOOSE_MS)!;
  assert.equal(phaseOf(room), "drawing", "no choice in time means the first word");
  assert.equal(room.game!.turn!.word, room.game!.turn!.options[0]);
  const ran = T0 + 33_000 + REVEAL_MS + CHOOSE_MS + 60_000;
  room = reduce(events, ran)!;
  assert.equal(phaseOf(room), "reveal");
  assert.equal(room.game!.scores.get("b"), 388, "nobody got it, so the drawer gets nothing");

  // Four more turns of 81 seconds each, untouched: c, then a, b and c again in round two.
  room = reduce(events, ran + REVEAL_MS + 4 * 81_000 - 1)!;
  assert.equal(phaseOf(room), "reveal");
  assert.equal(room.game!.round, 2);
  assert.equal(room.game!.turn!.drawer, "c");
  room = reduce(events, ran + REVEAL_MS + 4 * 81_000)!;
  assert.equal(phaseOf(room), "final");
  assert.equal(room.game!.used.size, 6, "no word came up twice");
  assert.ok(room.notes.some((n) => n.kind === "round" && n.round === 2) && room.notes.at(-1)!.kind === "over");
});

await check("hints uncover letters at half time and three quarters", () => {
  const events: DrawEvent[] = [create({ words: ["elephant", "toothbrush", "giraffe"], only: true, time: 80 }), join("a"), join("b"), start("a")];
  let room = reduce(events, T0)!;
  const i = room.game!.turn!.options.indexOf("elephant");
  assert.ok(i >= 0, "only the host's words are on offer");
  events.push({ k: "choose", t: T0 + 1000, p: "a", turn: room.game!.turn!.id, i });
  room = reduce(events, T0 + 1000)!;
  const turn = room.game!.turn!;
  assert.equal(hintPositions(room, turn, T0 + 40_999).size, 0);
  assert.equal(hintPositions(room, turn, T0 + 41_000).size, 1);
  const first = [...hintPositions(room, turn, T0 + 41_000)][0];
  const two = hintPositions(room, turn, T0 + 61_000);
  assert.equal(two.size, 2);
  assert.ok(two.has(first), "the second hint keeps the first");
  const mask = viewOf(reduce(events, T0 + 61_000)!, T0 + 61_000).game!.turn!.mask!;
  assert.equal([...mask].filter((ch) => ch !== "_").length, 2);
  assert.ok([...two].every((p) => mask[p] === "elephant"[p]));
});

await check("the host's words are mixed in, one of every three", () => {
  const events: DrawEvent[] = [create({ words: ["our teacher", "pizza friday", "the bus"] }), join("a"), join("b"), start("a")];
  const room = reduce(events, T0)!;
  const [mine, ...others] = room.game!.turn!.options;
  assert.ok(["our teacher", "pizza friday", "the bus"].includes(mine));
  assert.ok(others.every((w) => WORDS.includes(w)));
  assert.equal(viewOf(room, T0).settings.words, 3, "everyone sees how many, not which");
  assert.equal(privateView(room, "b").words, null);
  assert.deepEqual(privateView(room, "a").words, ["our teacher", "pizza friday", "the bus"]);
});

await check("leaving moves the game on, and too few players ends it", () => {
  const base: DrawEvent[] = [create(), join("a"), join("b"), join("c"), start("a")];
  let room = reduce([...base, { k: "leave", t: T0 + 1000, p: "a", why: "left" }], T0 + 1000)!;
  assert.equal(room.host, "b", "the next to have joined hosts");
  assert.equal(room.game!.turn!.drawer, "b", "the drawer left while choosing, so the next one draws");
  assert.equal(room.game!.turn!.chooseBy, T0 + 1000 + CHOOSE_MS);

  const drawing: DrawEvent[] = [...base, { k: "choose", t: T0 + 1000, p: "a", turn: 1, i: 0 }, { k: "guess", t: T0 + 2000, p: "b", turn: 1 }];
  room = reduce([...drawing, { k: "leave", t: T0 + 5000, p: "a", why: "left" }], T0 + 5000)!;
  assert.equal(phaseOf(room), "reveal", "the drawer left mid-drawing");
  assert.equal(room.game!.scores.get("a"), 0);
  assert.ok(room.game!.scores.get("b")! > 0, "a guess made stays made");

  room = reduce([...drawing, { k: "leave", t: T0 + 5000, p: "c", why: "left" }], T0 + 5000)!;
  assert.equal(phaseOf(room), "reveal", "the only one left to guess went, so everyone still here has it");

  room = reduce([create(), join("a"), join("b"), start("a"), { k: "leave", t: T0 + 1000, p: "b", why: "gone" }], T0 + 1000)!;
  assert.equal(phaseOf(room), "final");
});

await check("someone joining mid-game gets a turn this round", () => {
  const events: DrawEvent[] = [create({ time: 60 }), join("a"), join("b"), start("a"), join("c", T0 + 500)];
  assert.deepEqual(reduce(events, T0 + 500)!.game!.order, ["a", "b", "c"]);
  const room = reduce(events, T0 + 2 * 81_000)!;
  assert.equal(room.game!.turn!.drawer, "c");
  assert.equal(room.game!.round, 1);
});

await check("only the host removes people, the removed stay out, and rooms cap at twelve", () => {
  const events: DrawEvent[] = [
    create(),
    join("a"),
    join("b"),
    join("c"),
    { k: "leave", t: T0, p: "c", why: "kicked", by: "b" },
    { k: "leave", t: T0, p: "c", why: "kicked", by: "a" },
    join("c", T0 + 1),
  ];
  const room = reduce(events, T0 + 1)!;
  assert.equal(room.players.get("c")!.active, false);
  assert.equal(room.players.get("c")!.kicked, true);
  const crowd: DrawEvent[] = [create(), ...Array.from({ length: 14 }, (_, i) => join(`p${i}`))];
  assert.equal([...reduce(crowd, T0)!.players.values()].filter((p) => p.active).length, MAX_PLAYERS);
});

await check("settings are checked and tidied", () => {
  assert.equal(cleanSettings({ rounds: 7, time: 80, words: [], only: false }), null);
  assert.equal(cleanSettings({ rounds: 3, time: 30, words: [], only: false }), null);
  assert.equal(cleanSettings({ rounds: 3, time: 80, words: "cat", only: false }), null);
  assert.equal(cleanSettings({ rounds: 3, time: 80, words: Array(201).fill("cat"), only: false }), null);
  assert.equal(cleanSettings({ rounds: 3, time: 80, words: [], only: "yes" }), null);
  assert.deepEqual(cleanSettings({ rounds: 3, time: 80, words: [" Pizza  Friday ", "pizza friday", "x", 5, "ok"], only: true }), {
    rounds: 3,
    time: 80,
    words: ["pizza friday", "ok"],
    only: false,
  });
});

/* ------------------------------------------------------------- service */

async function playThrough(store: RoomStore<DrawEvent>, clock: { now: number }, heavy = false) {
  const created = await createRoom(store, { name: "ann" }, clock.now);
  const code = created.room.code;
  assert.match(code, CODE_PATTERN);
  const ann = created.you!;
  const ben = (await act(store, code.toLowerCase(), { type: "join", name: "ben" }, (clock.now += 1000))).you!;
  const as = (who: Identity, body: Record<string, unknown>) => act(store, code, { ...body, player: who.id, token: who.token }, clock.now);
  const ink = (who: Identity, turn: number, ops: unknown) => draw(store, code, { type: "ink", player: who.id, token: who.token, turn, ops }, clock.now);

  await assert.rejects(as(ben, { type: "start" }), fails(403));
  await assert.rejects(as({ ...ben, token: "nope" }, { type: "say", text: "hi" }), fails(401));
  const own = ["Our Teacher", "pizza friday", "the bus"];
  let reply = await as(ann, { type: "settings", settings: { rounds: 2, time: 60, words: own, only: true } });
  assert.equal(reply.room.settings.words, 3);
  assert.deepEqual(reply.mine!.words, ["our teacher", "pizza friday", "the bus"]);
  assert.equal((await as(ben, { type: "me" })).mine!.words, null, "the host's words are theirs");

  reply = await as(ann, { type: "start" });
  const turn = reply.room.game!.turn!;
  assert.equal(turn.phase, "choosing");
  assert.equal(reply.mine!.options!.length, 3);
  await assert.rejects(as(ben, { type: "choose", turn: turn.id, i: 0 }), fails(409));
  reply = await as(ann, { type: "choose", turn: turn.id, i: 2 });
  const word = reply.mine!.word!;
  assert.ok(["our teacher", "pizza friday", "the bus"].includes(word));
  assert.ok(!JSON.stringify(await getRoom(store, code, clock.now)).includes(word), "what everyone can read never has the word");

  const line: Op[] = [["l", 0, 12, 1, 10, 10, 20, 20]];
  assert.deepEqual(await ink(ann, turn.id, line), { count: 1 });
  await assert.rejects(ink(ben, turn.id, line), fails(409));
  await assert.rejects(ink(ann, turn.id, [["l", 0, 99, 1, 1, 1]]), fails(400));
  await assert.rejects(ink(ann, turn.id + 1, line), fails(409));
  assert.deepEqual(await ink(ann, turn.id, [["u", 0]]), { count: 2 });
  let view = await getRoom(store, code, clock.now, { turn: turn.id, from: 1 });
  assert.deepEqual(view.ink, { turn: turn.id, from: 1, batches: [[["u", 0]]] });
  assert.deepEqual((await getRoom(store, code, clock.now, { turn: turn.id, from: 0 })).ink!.batches, [line, [["u", 0]]]);

  if (heavy) {
    for (let i = 2; i < MAX_BATCHES_PER_TURN; i++) await ink(ann, turn.id, line);
    await assert.rejects(ink(ann, turn.id, line), fails(409), "a turn's drawing has a limit");
  }

  const drawerKey = (await as(ann, { type: "me" })).mine!.key!;
  assert.ok(drawerKey, "the drawer holds the key to the insiders' chat");
  assert.equal((await as(ben, { type: "me" })).mine!.key, null, "a guesser doesn't");
  assert.equal((await as(ann, { type: "say", text: `it's ${word}!` })).said, "sent");
  assert.equal((await as(ben, { type: "say", text: "hello" })).said, "sent");
  assert.equal((await as(ben, { type: "say", text: `is it ${word} lol` })).said, "hidden", "a guesser can't give it away either");
  const near = word.slice(0, -1) + (word.endsWith("x") ? "y" : "x");
  assert.equal((await as(ben, { type: "say", text: near })).said, "close");
  view = await getRoom(store, code, clock.now);
  assert.deepEqual(
    view.chat.filter((c) => c.g === undefined).map((c) => [c.n, c.text]),
    [["ben", "hello"]],
    "near misses and giveaways stay with whoever typed them",
  );
  const sealed = view.chat.filter((c) => c.g !== undefined);
  assert.deepEqual(sealed.map((c) => [c.n, c.g]), [["ann", turn.id]]);
  assert.ok(!JSON.stringify(view).includes(word), "the drawer's line is sealed, so even the raw reply doesn't give it away");
  assert.equal(await unseal(drawerKey, sealed[0].iv!, sealed[0].text), `it's ${word}!`);

  clock.now += 10_000;
  reply = await as(ben, { type: "say", text: `  ${word.toUpperCase()} ` });
  assert.equal(reply.said, "correct");
  assert.equal(reply.mine!.word, word);
  assert.equal(reply.room.game!.turn!.phase, "reveal", "everyone got it");
  assert.equal(reply.room.game!.turn!.word, word);
  assert.ok(reply.room.notes.some((n) => n.kind === "guessed" && n.name === "ben"));

  clock.now += REVEAL_MS;
  view = await getRoom(store, code, clock.now);
  assert.equal(view.game!.turn!.drawer, ben.id);
  await assert.rejects(ink(ann, turn.id, line), fails(409), "last turn's drawing is closed");

  // Ben's tab goes quiet (someone tries to keep him looking alive without his secret), so the game can't go on.
  await ping(store, code, { player: ben.id, token: "forged" }, clock.now);
  for (let waited = 0; waited <= GONE_MS; waited += 20_000) {
    clock.now += 20_000;
    await ping(store, code, { player: ann.id, token: ann.token }, clock.now);
  }
  await assert.rejects(ping(store, code, { player: "<script>", token: "x" }, clock.now), fails(401));
  view = await getRoom(store, code, clock.now);
  assert.equal(view.players.find((p) => p.id === ben.id)?.active, false);
  assert.equal(view.game!.phase, "final");
  await assert.rejects(as(ann, { type: "start" }), fails(409));

  // He's back, and a new game starts straight from the final scores.
  reply = await act(store, code, { type: "join", name: "ben", player: ben.id, token: ben.token }, clock.now);
  assert.equal(reply.you!.id, ben.id);
  reply = await as(ann, { type: "start" });
  assert.equal(reply.room.game!.index, 2);
  assert.equal(reply.room.game!.phase, "choosing");

  reply = await as(ann, { type: "kick", target: ben.id });
  assert.ok(!reply.room.players.some((p) => p.id === ben.id && p.active));
  await assert.rejects(act(store, code, { type: "join", name: "ben", player: ben.id, token: ben.token }, clock.now), fails(403));
  await assert.rejects(getRoom(store, "ZZZZ", clock.now), fails(404));
  await assert.rejects(getRoom(store, "not a code", clock.now), fails(404));
  await assert.rejects(createRoom(store, { name: " " }, clock.now), fails(400));
  return { code, turn: turn.id };
}

await check("the drawer and whoever's guessed talk among themselves, sealed from everyone still guessing", async () => {
  const clock = { now: T0 };
  const store = new MemoryStore<DrawEvent>(() => clock.now);
  const created = await createRoom(store, { name: "ann" }, clock.now);
  const code = created.room.code;
  const ann = created.you!;
  const ben = (await act(store, code, { type: "join", name: "ben" }, clock.now)).you!;
  const cat = (await act(store, code, { type: "join", name: "cat" }, clock.now)).you!;
  const as = (who: Identity, body: Record<string, unknown>) => act(store, code, { ...body, player: who.id, token: who.token }, clock.now);
  await as(ann, { type: "settings", settings: { rounds: 2, time: 60, words: ["pizza friday", "the school bus", "our teacher"], only: true } });
  const turn = (await as(ann, { type: "start" })).room.game!.turn!;
  const word = (await as(ann, { type: "choose", turn: turn.id, i: 0 })).mine!.word!;
  const key = (await as(ann, { type: "me" })).mine!.key!;
  assert.equal((await as(cat, { type: "me" })).mine!.key, null);
  const guessed = await as(ben, { type: "say", text: word });
  assert.equal(guessed.said, "correct");
  assert.equal(guessed.mine!.key, key, "getting it gets you the key");
  assert.equal((await as(ben, { type: "say", text: `ha, ${word}` })).said, "sent", "insiders can say the word to each other");
  await as(cat, { type: "say", text: "no idea" });
  let view = await getRoom(store, code, clock.now);
  assert.deepEqual(view.chat.filter((c) => c.g === undefined).map((c) => c.text), ["no idea"]);
  const sealed = view.chat.find((c) => c.g !== undefined)!;
  assert.equal(await unseal(key, sealed.iv!, sealed.text), `ha, ${word}`);
  assert.equal(await unseal(await turnKey("a guess at the salt", turn.id), sealed.iv!, sealed.text), null, "no other key opens it");
  assert.notEqual(await turnKey("salt", 1), await turnKey("salt", 2), "each turn has its own");
  // Once the drawing's over, everyone talks in the open again.
  clock.now += 60_000;
  assert.equal((await as(ben, { type: "say", text: "gg" })).said, "sent");
  view = await getRoom(store, code, clock.now);
  assert.ok(view.chat.some((c) => c.text === "gg" && c.g === undefined));
  assert.equal((await as(ben, { type: "me" })).mine!.key, null);
});

await check("the drawing API plays a game through, in memory", async () => {
  const clock = { now: T0 };
  const store = new MemoryStore<DrawEvent>(() => clock.now);
  const { code } = await playThrough(store, clock, true);
  clock.now += 7 * 60 * 60 * 1000;
  await assert.rejects(getRoom(store, code, clock.now), fails(404), "rooms expire");
});

await check("the same game plays through Upstash's REST protocol, with the chat and drawing beside the log", async () => {
  const upstash = await fakeUpstash("secret");
  try {
    const clock = { now: T0 };
    const { code, turn } = await playThrough(new UpstashStore<DrawEvent>(upstash.url, "secret", "draw"), clock);
    const inkKey = `draw:room:${code}:ink:${turn}`;
    assert.equal(upstash.lists.get(inkKey)!.length, 2);
    assert.equal(upstash.lists.get(`draw:room:${code}:chat`)!.length, 2, "ben's hello, and the drawer's sealed line");
    for (const key of [`draw:room:${code}:log`, `draw:room:${code}:chat`, inkKey]) assert.equal(upstash.ttls.get(key), 6 * 60 * 60, `${key} expires`);
    assert.equal(upstash.commands.filter(([name, key]) => name === "EXPIRE" && key === inkKey).length, 1, "a drawing's expiry is set once, not per batch");
  } finally {
    await upstash.close();
  }
});

await check("the drawing is asked for by turn and batch", () => {
  assert.deepEqual(parseInkQuery("3.16"), { turn: 3, from: 16 });
  assert.equal(parseInkQuery(null), undefined);
  assert.equal(parseInkQuery("3"), undefined);
  assert.equal(parseInkQuery("3.-1"), undefined);
  assert.equal(parseInkQuery("x.1"), undefined);
});

console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} draw checks passed`);
