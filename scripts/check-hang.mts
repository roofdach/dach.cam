/**
 * Checks for /hang: the words, what counts as a letter and a guess, the
 * scoring, a race and taking turns from their rules down to the API against
 * memory and a pretend Upstash. `npm run check` runs it after shape's.
 */

import assert from "node:assert/strict";

import {
  CHOOSE_MS,
  COUNTDOWN_MS,
  DEFAULT_SETTINGS,
  LETTER_POINTS,
  REVEAL_MS,
  cleanSettings,
  phaseOf,
  privateView,
  raceWords,
  reduce,
  setterPoints,
  solvePoints,
  viewOf,
  type HangEvent,
  type Room,
  type Settings,
} from "../lib/hang/room.ts";
import { act, createRoom, getRoom, type Identity } from "../lib/hang/server/rooms.ts";
import { CATEGORIES, LIVES, WORDS, cleanGuess, cleanWord, lettersOf, maskOf, sameWord } from "../lib/hang/words.ts";
import { CODE_PATTERN } from "../lib/rooms/codes.ts";
import { RoomError } from "../lib/rooms/http.ts";
import { MemoryStore, UpstashStore, type RoomStore } from "../lib/rooms/store.ts";
import { fakeUpstash } from "./fake-upstash.mts";

const results: string[] = [];
async function check(name: string, body: () => void | Promise<void>) {
  await body();
  results.push(name);
}

const T0 = Date.UTC(2026, 8, 29, 12);
const fails = (status: number) => (e: unknown) => e instanceof RoomError && e.status === status;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
/** Letters that aren't in a word, for guessing wrong on purpose. */
const missing = (word: string) => [...ALPHABET].filter((ch) => !word.includes(ch));

/* --------------------------------------------------------------- words */

await check("the words are many, tidy, and each in a category", () => {
  assert.ok(WORDS.length >= 450, `${WORDS.length} words`);
  assert.ok(CATEGORIES.length >= 12);
  for (const category of CATEGORIES) assert.ok(WORDS.filter((w) => w.category === category).length >= 30, `${category} has plenty`);
  assert.equal(new Set(WORDS.map((w) => lettersOf(w.text))).size, WORDS.length, "no word twice, even spaced differently");
  for (const { text } of WORDS) {
    assert.equal(cleanWord(text), text, `"${text}" is as a host's word would be kept`);
    assert.match(text, /^[a-z]+( [a-z]+)*$/, `"${text}" is plain letters`);
  }
});

await check("letters, masks and guesses read the way people type them", () => {
  assert.equal(maskOf("ice cream", new Set()), "___ _____");
  assert.equal(maskOf("ice cream", new Set(["e", "c"])), "_ce c_e__");
  assert.equal(maskOf("jack-o'-lantern", new Set(["a"])), "_a__-_'-_a_____");
  assert.equal(maskOf("room 101", new Set()), "____ 101", "digits show from the start");
  assert.equal(cleanWord("  Seán’s   Café! "), "sean's cafe");
  assert.equal(cleanWord("Straße"), "strasse");
  assert.equal(cleanWord("ab"), null, "too few letters");
  assert.equal(cleanWord("a 1 2 3"), null);
  assert.equal(cleanWord("x".repeat(31)), null);
  assert.equal(cleanWord(42), null);
  assert.equal(cleanGuess("E"), "e");
  assert.equal(cleanGuess(" é "), "e");
  assert.equal(cleanGuess("a!"), "a");
  assert.equal(cleanGuess(" Ice-Cream "), "ice-cream");
  assert.equal(cleanGuess("!!"), null);
  assert.equal(cleanGuess("x".repeat(200)), null);
  assert.ok(sameWord("icecream", "ice cream") && sameWord("ICE CREAM".toLowerCase(), "ice cream") && !sameWord("ice", "ice cream"));
});

await check("getting it sooner, with more of you left, scores more; picking scores for what the others lose", () => {
  assert.equal(solvePoints(1, LIVES), 900);
  assert.equal(solvePoints(0, 1), 150);
  assert.equal(solvePoints(0.5, 3), 500);
  assert.equal(solvePoints(-1, 1), 150, "late is never less than nothing");
  assert.equal(setterPoints(12, 4), 300);
  assert.equal(setterPoints(0, 3), 0);
  assert.equal(setterPoints(5, 0), 0);
});

await check("settings are checked against the mode they're for", () => {
  assert.deepEqual(cleanSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, rounds: 2 }), null, "a race is 5, 10 or 15 words");
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, mode: "turns", rounds: 10 }), null, "taking turns is 1 to 3 times round");
  assert.ok(cleanSettings({ ...DEFAULT_SETTINGS, mode: "turns", rounds: 3 }));
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, time: 45 }), null);
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, mode: "solo" }), null);
  const tidied = cleanSettings({ ...DEFAULT_SETTINGS, words: ["Giraffe", "giraffe", "ab", " ice  cream "], only: true })!;
  assert.deepEqual(tidied.words, ["giraffe", "ice cream"]);
  assert.equal(tidied.only, false, "only your own words needs three of them");
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, words: Array(201).fill("word") }), null);
});

await check("a race's words are fixed by the salt, never repeat, and mix in the host's", () => {
  const plain = raceWords("salt", 1, { ...DEFAULT_SETTINGS, rounds: 15 });
  assert.equal(plain.length, 15);
  assert.equal(new Set(plain.map((w) => w.text)).size, 15);
  assert.deepEqual(raceWords("salt", 1, { ...DEFAULT_SETTINGS, rounds: 15 }), plain, "the same salt, the same words");
  assert.notDeepEqual(raceWords("salt", 2, { ...DEFAULT_SETTINGS, rounds: 15 }), plain, "each game has its own");
  const theirs = ["our teacher", "the school bus", "pizza friday", "mr murphy", "giraffe"];
  const mixed = raceWords("salt", 1, { ...DEFAULT_SETTINGS, rounds: 10, words: theirs });
  assert.equal(mixed.length, 10);
  assert.equal(mixed.filter((w) => w.category === null).length, 4, "a third of the game, rounded up");
  assert.equal(new Set(mixed.map((w) => w.text)).size, 10);
  const everyGame = Array.from({ length: 40 }, (_, i) => raceWords("salt", i, { ...DEFAULT_SETTINGS, rounds: 15, words: theirs })).flat();
  assert.ok(everyGame.some((w) => w.text === "giraffe"));
  assert.ok(everyGame.every((w) => w.text !== "giraffe" || w.category === null), "a word the host has too only comes as theirs");
  const only = raceWords("salt", 1, { ...DEFAULT_SETTINGS, rounds: 10, words: theirs, only: true });
  assert.equal(only.length, 5, "only their words: as long as their list");
  assert.ok(only.every((w) => w.category === null));
});

/* ---------------------------------------------------------------- race */

const create = (settings: Partial<Settings> = {}): HangEvent => ({ k: "create", t: T0, code: "BCDF", salt: "salt", settings: { ...DEFAULT_SETTINGS, ...settings } });
const join = (p: string, t = T0): HangEvent => ({ k: "join", t, p, name: p, tok: `tok-${p}` });
const guess = (p: string, t: number, round: number, g: string, game = 1): HangEvent => ({ k: "guess", t, p, game, round, g });
const wordOf = (room: Room) => room.game!.rounds.at(-1)!.word!.text;

await check("a race: a countdown, one word for all, letters, misses, hangings, early ends, a reveal, the end", () => {
  const events: HangEvent[] = [create({ rounds: 5, time: 60, words: ["giraffe", "ice cream", "zebra"], only: true }), join("a"), join("b"), join("c"), { k: "start", t: T0, p: "a" }];
  let room = reduce(events, T0 + 1000)!;
  assert.equal(phaseOf(room), "countdown");
  assert.equal(room.game!.words.length, 3);
  assert.equal(viewOf(room, T0 + 1000).game!.pattern, null, "nothing to see before it starts");
  assert.equal(privateView(room, "a").round, null);

  const start = T0 + COUNTDOWN_MS;
  room = reduce(events, start)!;
  assert.equal(phaseOf(room), "playing");
  const word = wordOf(room);
  const letters = lettersOf(word);
  const view = viewOf(room, start);
  assert.equal(view.game!.pattern, maskOf(word, new Set()));
  assert.equal(view.game!.letters, letters.length);
  assert.equal(view.game!.word, null);
  assert.equal(view.game!.clue, null, "one of the host's own");
  assert.ok(!JSON.stringify(view).includes(word) && !JSON.stringify(view).includes("salt"), "the view never says what it is");

  const hit = letters[0];
  const count = [...letters].filter((ch) => ch === hit).length;
  const wrong = missing(word);
  events.push(guess("a", start + 1000, 0, hit.toUpperCase()));
  // A letter twice counts once.
  events.push(guess("a", start + 1500, 0, hit));
  events.push(guess("b", start + 2000, 0, wrong[0]));
  room = reduce(events, start + 2000)!;
  assert.equal(room.game!.scores.get("a"), LETTER_POINTS * count);
  assert.deepEqual(privateView(room, "a").round!.guesses, [hit]);
  assert.equal(privateView(room, "a").round!.mask, maskOf(word, new Set([hit])));
  assert.equal(privateView(room, "a").round!.word, null, "no word till you've got it");
  assert.deepEqual(viewOf(room, start + 2000).game!.boards.b, { misses: 1, shown: 0, tries: 1, points: 0, took: null, place: null, hanged: false, guesses: null });

  // A quarter of the way in: three quarters of the time left, one letter found.
  events.push(guess("a", start + 15_000, 0, word.toUpperCase().replace(/ /g, "")));
  room = reduce(events, start + 15_000)!;
  assert.equal(room.game!.scores.get("a"), LETTER_POINTS * letters.length + solvePoints(0.75, LIVES));
  assert.equal(privateView(room, "a").round!.word, word, "once you've got it, you see it");
  assert.equal(privateView(room, "b").round!.word, null);
  assert.deepEqual([viewOf(room, start + 15_000).game!.boards.a.took, viewOf(room, start + 15_000).game!.boards.a.place], [15_000, 1]);

  events.push(guess("c", start + 16_000, 0, "wrongword"), guess("c", start + 16_500, 0, "wrong word"));
  for (let i = 1; i < LIVES; i++) events.push(guess("b", start + 20_000 + i, 0, wrong[i]));
  events.push(guess("b", start + 21_000, 0, wrong[LIVES]));
  room = reduce(events, start + 21_000)!;
  assert.equal(privateView(room, "b").round!.hanged, true);
  assert.equal(privateView(room, "b").round!.guesses.length, LIVES, "hanged is hanged: no more goes");
  assert.equal(viewOf(room, start + 21_000).game!.boards.c.misses, 1, "a wrong go at the word costs a life, once");
  assert.equal(phaseOf(room), "playing", "c's still going");

  events.push({ k: "leave", t: start + 22_000, p: "c", why: "left" });
  room = reduce(events, start + 22_000)!;
  assert.equal(phaseOf(room), "reveal", "a has it, b's hanged and c's gone: nobody's still trying");
  const reveal = viewOf(room, start + 22_000).game!;
  assert.equal(reveal.word, word);
  assert.deepEqual(reveal.boards.c.guesses, ["wrongword"]);
  assert.equal(privateView(room, "b").round!.word, word, "everyone sees it once it's over");

  room = reduce(events, start + 22_000 + REVEAL_MS)!;
  assert.equal(phaseOf(room), "playing");
  assert.equal(viewOf(room, start + 22_000 + REVEAL_MS).game!.round, 1);
  assert.notEqual(wordOf(room), word);
  // Nobody guesses the other two: a minute and a reveal each.
  const end = start + 22_000 + REVEAL_MS + 2 * (60_000 + REVEAL_MS);
  assert.equal(phaseOf(reduce(events, end - 1)!), "reveal");
  room = reduce(events, end)!;
  assert.equal(phaseOf(room), "final");
  const history = viewOf(room, end).game!.history!;
  assert.deepEqual(history.map((h) => h.word).sort(), ["giraffe", "ice cream", "zebra"]);
  assert.equal(history[0].results.a.took, 15_000);
  assert.equal(history[0].results.b.hanged, true);
  assert.ok(viewOf(room, end).players.some((p) => p.id === "a" && p.score > 0));
});

await check("joining a race midway gets a board, and the host can start again from the end", () => {
  const events: HangEvent[] = [create({ rounds: 5, time: 30 }), join("a"), { k: "start", t: T0, p: "a" }];
  const start = T0 + COUNTDOWN_MS;
  events.push(join("b", start + 10_000));
  let room = reduce(events, start + 10_000)!;
  const word = wordOf(room);
  events.push(guess("b", start + 11_000, 0, word));
  room = reduce(events, start + 11_000)!;
  assert.equal(phaseOf(room), "playing", "a hasn't got it yet");
  assert.equal(room.game!.scores.get("b"), LETTER_POINTS * lettersOf(word).length + solvePoints(19 / 30, LIVES));
  events.push({ k: "start", t: start + 12_000, p: "a" }, { k: "settings", t: start + 12_000, p: "a", settings: { ...DEFAULT_SETTINGS, time: 90 } });
  room = reduce(events, start + 12_000)!;
  assert.equal(room.games, 1, "no starting over mid-game");
  assert.equal(room.settings.time, 30, "no changing the settings mid-game");
  const end = start + 5 * (30_000 + REVEAL_MS);
  events.push({ k: "start", t: end, p: "a" });
  room = reduce(events, end)!;
  assert.equal(room.games, 2);
  assert.equal(phaseOf(room), "countdown");
  assert.equal(room.game!.scores.size, 0, "a new game, new scores");
});

/* --------------------------------------------------------------- turns */

await check("taking turns: each picks from three, the rest guess, and the picker scores for what they lose", () => {
  const events: HangEvent[] = [create({ mode: "turns", rounds: 1, time: 60 }), join("a"), join("b"), join("c"), { k: "start", t: T0, p: "a" }];
  let room = reduce(events, T0)!;
  assert.equal(phaseOf(room), "choosing");
  const first = room.game!.rounds[0];
  assert.equal(first.setter, "a");
  assert.equal(new Set(first.options!.map((w) => w.text)).size, 3);
  assert.equal(new Set(first.options!.map((w) => w.category)).size, 3, "three different categories");
  assert.deepEqual(privateView(room, "a").round!.options!.map((o) => o.text), first.options!.map((w) => w.text));
  assert.equal(privateView(room, "b").round!.options, null, "only the picker sees the choice");
  assert.ok(first.options!.every((w) => !JSON.stringify(viewOf(room, T0)).includes(`"${w.text}"`)));

  // Only the picker picks.
  events.push({ k: "choose", t: T0 + 1000, p: "b", game: 1, round: 0, i: 1 });
  events.push({ k: "choose", t: T0 + 2000, p: "a", game: 1, round: 0, i: 2 });
  room = reduce(events, T0 + 2000)!;
  assert.equal(phaseOf(room), "playing");
  const word = wordOf(room);
  assert.equal(word, first.options![2].text);
  assert.equal(viewOf(room, T0 + 2000).game!.clue, first.options![2].category);
  assert.equal(privateView(room, "a").round!.word, word, "the picker knows it");
  assert.equal(privateView(room, "a").round!.mask, null);

  const wrong = missing(word);
  // The picker can't guess.
  events.push(guess("a", T0 + 3000, 0, lettersOf(word)[0]));
  events.push(guess("b", T0 + 4000, 0, wrong[0]), guess("b", T0 + 5000, 0, wrong[1]), guess("b", T0 + 6000, 0, word));
  for (let i = 0; i < LIVES; i++) events.push(guess("c", T0 + 7000 + i, 0, wrong[i]));
  room = reduce(events, T0 + 8000)!;
  assert.equal(room.game!.rounds[0].boards.has("a"), false);
  assert.equal(phaseOf(room), "reveal");
  assert.equal(room.game!.scores.get("a"), setterPoints(2 + LIVES, 2));
  assert.equal(viewOf(room, T0 + 8000).game!.setterPoints, 400);

  // b's turn: b doesn't pick in time, so it's the first word.
  const second = T0 + 7005 + REVEAL_MS;
  room = reduce(events, second)!;
  assert.equal(phaseOf(room), "choosing");
  assert.equal(room.game!.rounds[1].setter, "b");
  assert.ok(!room.game!.rounds[1].options!.some((w) => w.text === word), "a word doesn't come up twice");
  events.push(join("d", second + 1000));
  room = reduce(events, second + CHOOSE_MS)!;
  assert.equal(phaseOf(room), "playing");
  assert.equal(wordOf(room), room.game!.rounds[1].options![0].text);

  // Nobody guesses; then c's turn, and c leaves before picking, which leaves the first word.
  const third = second + CHOOSE_MS + 60_000 + REVEAL_MS;
  room = reduce(events, third)!;
  assert.equal(room.game!.rounds[1].setterPoints, 0, "nobody lost anything");
  assert.equal(room.game!.rounds[2].setter, "c");
  events.push({ k: "leave", t: third + 1000, p: "c", why: "left" });
  room = reduce(events, third + 1000)!;
  assert.equal(phaseOf(room), "playing");
  events.push(guess("a", third + 2000, 2, missing(wordOf(room))[0]));
  const fourth = third + 1000 + 60_000 + REVEAL_MS;
  room = reduce(events, fourth)!;
  assert.equal(room.game!.rounds[2].setterPoints, 0, "a picker who's gone scores nothing");
  assert.equal(room.game!.rounds[3].setter, "d", "someone who came in midway still gets a turn");
  room = reduce(events, fourth + CHOOSE_MS + 60_000 + REVEAL_MS)!;
  assert.equal(phaseOf(room), "final", "once round everyone");
  assert.equal(viewOf(room, fourth + CHOOSE_MS + 60_000 + REVEAL_MS).game!.history!.length, 4);
});

await check("taking turns needs two, and ends when there aren't two left", () => {
  let room = reduce([create({ mode: "turns", rounds: 2 }), join("a"), { k: "start", t: T0, p: "a" }], T0)!;
  assert.equal(room.game, null);
  const events: HangEvent[] = [create({ mode: "turns", rounds: 2 }), join("a"), join("b"), { k: "start", t: T0, p: "a" }, { k: "choose", t: T0, p: "a", game: 1, round: 0, i: 0 }];
  events.push({ k: "leave", t: T0 + 1000, p: "b", why: "left" });
  room = reduce(events, T0 + 1000)!;
  assert.equal(phaseOf(room), "reveal", "nobody left to guess");
  room = reduce(events, T0 + 1000 + REVEAL_MS)!;
  assert.equal(phaseOf(room), "final");
});

/* ----------------------------------------------------------------- api */

async function playThrough(store: RoomStore<HangEvent>, clock: { now: number }) {
  const created = await createRoom(store, { name: "ann" }, clock.now);
  const code = created.room.code;
  assert.match(code, CODE_PATTERN);
  const ann = created.you!;
  const ben = (await act(store, code.toLowerCase(), { type: "join", name: "ben" }, clock.now)).you!;
  const as = (who: Identity, body: Record<string, unknown>) => act(store, code, { ...body, player: who.id, token: who.token }, clock.now);

  await assert.rejects(as(ben, { type: "start" }), fails(403));
  await assert.rejects(as(ann, { type: "settings", settings: { ...DEFAULT_SETTINGS, mode: "turns", rounds: 10 } }), fails(400));
  const secret = ["our teacher", "the school bus", "pizza friday"];
  await as(ann, { type: "settings", settings: { mode: "turns", rounds: 1, time: 30, words: secret, only: true } });
  const lobby = await getRoom(store, code, clock.now);
  assert.equal(lobby.settings.mode, "turns");
  assert.equal(lobby.settings.words, 3, "everyone sees how many");
  assert.ok(!JSON.stringify(lobby).includes("pizza"), "but not what they are");
  assert.deepEqual((await as(ann, { type: "me" })).mine!.words, secret);
  assert.equal((await as(ben, { type: "me" })).mine!.words, null);

  await as(ann, { type: "start" });
  await assert.rejects(as(ben, { type: "choose", game: 1, round: 0, i: 0 }), fails(409), "it's ann's turn to pick");
  await assert.rejects(as(ben, { type: "guess", game: 1, round: 0, g: "a" }), fails(409), "nothing to guess yet");
  const options = (await as(ann, { type: "me" })).mine!.round!.options!;
  assert.deepEqual(options.map((o) => o.text).sort(), [...secret].sort());
  let reply = await as(ann, { type: "choose", game: 1, round: 0, i: 1 });
  const word = reply.mine!.round!.word!;
  assert.equal(word, options[1].text);
  await assert.rejects(as(ann, { type: "guess", game: 1, round: 0, g: "a" }), fails(409), "the picker can't guess");

  const hit = lettersOf(word)[0];
  reply = await as(ben, { type: "guess", game: 1, round: 0, g: hit.toUpperCase() });
  assert.deepEqual(reply.mine!.round!.guesses, [hit]);
  assert.equal(reply.mine!.round!.mask, maskOf(word, new Set([hit])));
  await assert.rejects(as(ben, { type: "guess", game: 1, round: 0, g: hit }), fails(409), "no letter twice");
  await assert.rejects(as(ben, { type: "guess", game: 1, round: 0, g: "?" }), fails(400));
  await assert.rejects(as(ben, { type: "guess", game: 2, round: 0, g: "q" }), fails(409), "a guess for another game");
  reply = await as(ben, { type: "guess", game: 1, round: 0, g: missing(word)[0] });
  assert.equal(reply.mine!.round!.misses, 1);
  reply = await as(ben, { type: "guess", game: 1, round: 0, g: word.toUpperCase() });
  assert.equal(reply.mine!.round!.solved, true);
  assert.equal(reply.room.game!.phase, "reveal", "ben was the only one guessing");
  assert.equal(reply.room.game!.word, word);
  assert.equal(reply.room.game!.setterPoints, 100);

  const after = await getRoom(store, code, clock.now);
  assert.equal(after.players.find((p) => p.id === ann.id)!.score, 100);
  assert.deepEqual(after.game!.boards[ben.id].guesses, [hit, missing(word)[0], word]);
  await as(ben, { type: "leave" });
  assert.equal((await getRoom(store, code, clock.now)).players.filter((p) => p.active).length, 1);
  await assert.rejects(getRoom(store, "ZZZZ", clock.now), fails(404));
  return code;
}

await check("the API plays a word through, in memory", async () => {
  const clock = { now: T0 };
  await playThrough(new MemoryStore<HangEvent>(() => clock.now), clock);
});

await check("and through Upstash's REST protocol", async () => {
  const upstash = await fakeUpstash("secret");
  try {
    const clock = { now: T0 };
    const code = await playThrough(new UpstashStore<HangEvent>(upstash.url, "secret", "hang"), clock);
    assert.ok(upstash.lists.get(`hang:room:${code}:log`)!.length > 8);
  } finally {
    await upstash.close();
  }
});

console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} hang checks passed`);
