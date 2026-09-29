/**
 * Checks for the arcade games, /flap and /snake: that both play back the
 * same every time and can be played well, the high score boards and what
 * they'll believe, and a versus room from its rules down to the API
 * against memory and a pretend Upstash. `npm run check` runs it after
 * sus's.
 */

import assert from "node:assert/strict";

import * as flap from "../lib/flap/game.ts";
import * as snake from "../lib/snake/game.ts";
import { outcome } from "../lib/arcade/games.ts";
import { COUNTDOWN_MS, GRACE_MS, ROUND_MS, phaseOf, reduce, seedFor, viewOf, type VersusEvent } from "../lib/arcade/room.ts";
import { MemoryScores, UpstashScores, dayOf, type ScoreStore } from "../lib/arcade/scores.ts";
import { LIVE_FRESH_MS, act, createRoom, getRoom, live, type Identity } from "../lib/arcade/server/rooms.ts";
import { issueTicket, submitRun, ticketSecret } from "../lib/arcade/server/scores.ts";
import { CODE_PATTERN } from "../lib/rooms/codes.ts";
import { RoomError } from "../lib/rooms/http.ts";
import { sign } from "../lib/rooms/seats.ts";
import { MemoryStore, UpstashStore, type RoomStore } from "../lib/rooms/store.ts";
import { fakeUpstash } from "./fake-upstash.mts";

const results: string[] = [];
async function check(name: string, body: () => void | Promise<void>) {
  await body();
  results.push(name);
}

const T0 = Date.UTC(2026, 8, 29, 12);
const fails = (status: number) => (e: unknown) => e instanceof RoomError && e.status === status;

/* ---------------------------------------------------------------- bots */

/** A bird that aims for just above the bottom of the next gap. */
function flapBot(seed: string, maxTicks = 60 * 60 * 5) {
  const course = new flap.Course(seed);
  const bird = flap.startBird();
  const flaps: number[] = [];
  while (!bird.dead && bird.tick < maxTicks) {
    const x = flap.BIRD_X + flap.scroll(bird.tick);
    let i = 0;
    while (course.pipe(i).x + flap.PIPE_W < x - flap.BIRD_R) i++;
    const go = bird.tick === 0 || (bird.y + bird.vy * 2 > course.pipe(i).bottom - 30 && bird.vy > -2);
    if (go) flaps.push(bird.tick);
    flap.step(bird, course, go);
  }
  return { bird, flaps };
}

/** A snake that heads straight for the nearest apple and doesn't walk into itself on the very next step. */
function snakeBot(seed: string, maxSteps = 3000) {
  const game = new snake.Game(seed);
  const s = game.snake;
  const turns: [number, snake.Dir][] = [];
  while (!s.dead && s.step < maxSteps) {
    const head = s.body[0];
    const [hx, hy] = [head % snake.COLS, Math.floor(head / snake.COLS)];
    const target = s.gold ? s.gold.cell : s.apple;
    const [tx, ty] = [target % snake.COLS, Math.floor(target / snake.COLS)];
    const safe = (d: snake.Dir) => {
      const [x, y] = [hx + snake.DX[d], hy + snake.DY[d]];
      return x >= 0 && y >= 0 && x < snake.COLS && y < snake.ROWS && !s.body.slice(0, -1).includes(snake.cell(x, y));
    };
    const away = (d: snake.Dir) => Math.abs(hx + snake.DX[d] - tx) + Math.abs(hy + snake.DY[d] - ty);
    const options = ([0, 1, 2, 3] as snake.Dir[]).filter((d) => !snake.opposite(d, s.dir) && safe(d)).sort((a, b) => away(a) - away(b));
    const d = options[0] ?? s.dir;
    if (d !== s.dir) turns.push([s.step, d]);
    game.step(d !== s.dir ? d : undefined);
  }
  return { snake: s, turns };
}

/* ---------------------------------------------------------------- flap */

await check("flap: a course is fair, and the same for the same seed", () => {
  const a = new flap.Course("abcdefghijkl");
  const b = new flap.Course("abcdefghijkl");
  const c = new flap.Course("zyxwvutsrqpo");
  let different = 0;
  for (let i = 0; i < 300; i++) {
    const pipe = a.pipe(i);
    assert.deepEqual(pipe, b.pipe(i));
    if (pipe.top !== c.pipe(i).top) different++;
    assert.ok(pipe.top >= 56 && pipe.bottom <= flap.GROUND - 56, "the gap's always on screen");
    assert.ok(pipe.bottom - pipe.top >= 100, "and never too narrow");
    if (i) assert.ok(Math.abs(pipe.top - a.pipe(i - 1).top) <= 150, "nor too far from the last to get to");
  }
  assert.ok(different > 250, "another seed, another course");
  assert.deepEqual(flap.pipesOnScreen(0), [0, -1], "nothing to start with");
});

await check("flap: a run plays back the same, falls if you don't flap, and can be played well", () => {
  const fall = flap.replay("abcdefghijkl", [0]);
  assert.equal(fall.dead, true);
  assert.equal(fall.score, 0);
  assert.equal(fall.y, flap.GROUND - flap.BIRD_R);
  for (const seed of ["abcdefghijkl", "mnopqrstuvwx", "000000000000"]) {
    const { bird, flaps } = flapBot(seed);
    assert.ok(bird.score >= 15, `a simple bot gets ${bird.score} on ${seed}`);
    assert.deepEqual(flap.replay(seed, flaps), bird, "and it plays back to the letter");
  }
  // Flapping non-stop hits the ceiling, not the sky: the first pipe still gets you.
  const frantic = flap.replay("abcdefghijkl", Array.from({ length: 400 }, (_, i) => i * 3));
  assert.equal(frantic.dead, true);
  assert.equal(frantic.score, 0);
  assert.equal(flap.cleanFlaps([0, 5, 9])?.length, 3);
  for (const bad of [[], [1, 5], [0, 5, 5], [0, 2.5], [0, -1], "0,1", [0, flap.MAX_TICKS]]) assert.equal(flap.cleanFlaps(bad), null, JSON.stringify(bad));
});

/* --------------------------------------------------------------- snake */

await check("snake: walls and your own tail kill you; apples grow you; no turning back on yourself", () => {
  const wall = new snake.Game("abcdefghijkl");
  for (let i = 0; i < 20 && !wall.snake.dead; i++) wall.step(0);
  assert.equal(wall.snake.dead, true, "straight up into the wall");
  assert.equal(wall.snake.step, Math.floor(snake.ROWS / 2) + 1);

  const g = new snake.Game("abcdefghijkl");
  g.step(3);
  assert.equal(g.snake.dir, 1, "left, straight back into yourself, doesn't count");
  for (let i = 0; i < 7; i++) g.step();
  assert.equal(g.snake.score, 1, "the first apple's straight ahead");
  assert.equal(g.snake.body.length, 4);
  assert.notEqual(g.snake.apple, snake.cell(12, 7));
  assert.ok(!g.snake.body.includes(g.snake.apple), "and the next isn't under you");

  // Round in a tight square, a four-long snake chases its own tail and lives (with the apple out of the way).
  g.snake.apple = snake.cell(0, 0);
  for (const d of [2, 3, 0, 1, 2, 3, 0, 1] as snake.Dir[]) g.step(d);
  assert.equal(g.snake.dead, false, "the tail moves out of the way");
  // A long snake turning back on itself doesn't.
  const long = new snake.Game("abcdefghijkl");
  long.snake.body = [snake.cell(8, 7), snake.cell(7, 7), snake.cell(6, 7), snake.cell(5, 7), snake.cell(4, 7), snake.cell(3, 7)];
  for (const d of [2, 3, 0] as snake.Dir[]) long.step(d);
  assert.equal(long.snake.dead, true);
});

await check("snake: every fifth apple brings a golden one for a while, and it all speeds up", () => {
  const { snake: s, turns } = snakeBot("abcdefghijkl");
  assert.ok(s.score >= 15, `a simple bot gets ${s.score}`);
  assert.deepEqual(snake.replay("abcdefghijkl", turns).snake, s, "and it plays back to the letter");
  const g = new snake.Game("abcdefghijkl");
  g.snake.eaten = 4;
  g.snake.apple = snake.cell(5, 7);
  g.step();
  assert.equal(g.snake.eaten, 5);
  assert.ok(g.snake.gold, "a golden apple");
  const until = g.snake.gold!.until;
  assert.equal(until, g.snake.step + snake.GOLD_STEPS);
  // Round and round a ring, out of the way of both apples, until it's gone.
  g.snake.apple = snake.cell(0, 0);
  g.snake.gold!.cell = snake.cell(0, 14);
  const ring: snake.Dir[] = [1, 1, 2, 2, 3, 3, 0, 0];
  for (let i = 0; g.snake.step < until; i++) g.step(ring[i % ring.length]);
  assert.equal(g.snake.dead, false);
  assert.equal(g.snake.gold, null, "which doesn't wait");
  assert.ok(snake.stepMs({ eaten: 0 }) > snake.stepMs({ eaten: 10 }));
  assert.equal(snake.stepMs({ eaten: 1000 }), 70);
  const body = [snake.cell(3, 3), snake.cell(3, 4), snake.cell(4, 4), snake.cell(4, 5), snake.cell(3, 5), snake.cell(2, 5)];
  assert.deepEqual(snake.unpackBody(snake.packBody(body)), body, "a snake squeezed and unsqueezed");
  for (const bad of [[[0, 4]], [[3, 1], [2, 1]], [[0, 1], [0, 2]], [[0, 1.5]], "no"]) assert.equal(snake.cleanTurns(bad), null, JSON.stringify(bad));
});

await check("played back, a run says what it scored, how long it took at the least, and stops on a clock", () => {
  const { bird, flaps } = flapBot("abcdefghijkl");
  assert.deepEqual(outcome("flap", "abcdefghijkl", flaps), { score: bird.score, length: bird.tick, over: true, ms: bird.tick * flap.TICK_MS });
  const stopped = outcome("flap", "abcdefghijkl", flaps, 10_000)!;
  assert.equal(stopped.over, false);
  assert.equal(stopped.length, 600);
  const { snake: s, turns } = snakeBot("abcdefghijkl");
  const run = outcome("snake", "abcdefghijkl", turns)!;
  assert.equal(run.score, s.score);
  assert.ok(run.ms > s.step * 70 && run.ms < s.step * 135);
  assert.equal(outcome("snake", "abcdefghijkl", turns, 5000)!.over, false);
  assert.equal(outcome("flap", "abcdefghijkl", "nonsense"), null);
});

/* -------------------------------------------------------------- boards */

async function boards(store: ScoreStore) {
  const day = dayOf(T0);
  assert.deepEqual(await store.submit("flap", "aaaa", "ann", 12, day), { best: 12, rank: 1, todayBest: 12, todayRank: 1 });
  await store.submit("flap", "bbbb", "ben", 30, day);
  assert.deepEqual(await store.submit("flap", "aaaa", "ann b", 5, day), { best: 12, rank: 2, todayBest: 12, todayRank: 2 }, "a worse run doesn't lower your best");
  await store.submit("flap", "cccc", "cat", 20, "2026-09-28");
  await store.submit("snake", "aaaa", "ann", 99, day);
  const flapBoards = await store.boards("flap", day);
  assert.deepEqual(flapBoards.all, [
    { who: "bbbb", name: "ben", score: 30 },
    { who: "cccc", name: "cat", score: 20 },
    { who: "aaaa", name: "ann b", score: 12 },
  ]);
  assert.deepEqual(flapBoards.today.map((l) => l.name), ["ben", "ann b"], "yesterday's isn't today's");
  assert.deepEqual((await store.boards("snake", day)).all, [{ who: "aaaa", name: "ann", score: 99 }], "each game has its own");
}

await check("the boards keep everyone's best, all time and today, in memory", () => boards(new MemoryScores()));

await check("and in Upstash", async () => {
  const upstash = await fakeUpstash("secret");
  try {
    await boards(new UpstashScores(upstash.url, "secret"));
    assert.ok(upstash.ttls.has(`flap:scores:day:${dayOf(T0)}`), "today's board lets itself go");
  } finally {
    await upstash.close();
  }
});

await check("a run only goes on the boards if it's played back, on a ticket of ours, in the time it takes", async () => {
  const store = new MemoryScores();
  const secret = ticketSecret({});
  assert.equal(ticketSecret({ ARCADE_SECRET: " s " }), "s");
  assert.equal(ticketSecret({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "tok" }), "tok");
  const ticket = await issueTicket("flap", T0, secret);
  const { bird, flaps } = flapBot(ticket.seed);
  const took = bird.tick * flap.TICK_MS;
  const body = { ticket, moves: flaps, name: "ann", player: "a".repeat(20) };
  await assert.rejects(submitRun(store, "flap", body, T0 + took / 2, secret), fails(409), "quicker than it could have been played");
  await assert.rejects(submitRun(store, "flap", { ...body, ticket: { ...ticket, seed: "easyeasyeasy" } }, T0 + took, secret), fails(400), "a course of your own");
  await assert.rejects(submitRun(store, "snake", body, T0 + took, secret), fails(400), "another game's ticket");
  await assert.rejects(submitRun(store, "flap", { ...body, name: " " }, T0 + took, secret), fails(400));
  await assert.rejects(submitRun(store, "flap", { ...body, player: "short" }, T0 + took, secret), fails(400));
  await assert.rejects(submitRun(store, "flap", body, T0 + 4 * 60 * 60 * 1000, secret), fails(409), "a ticket that's run out");
  const sent = await submitRun(store, "flap", body, T0 + took, secret);
  assert.equal(sent.score, bird.score);
  assert.deepEqual(sent.standing, { best: bird.score, rank: 1, todayBest: bird.score, todayRank: 1 });
  assert.deepEqual(sent.boards.all, [{ who: sent.who, name: "ann", score: bird.score }]);
  assert.match(sent.who, /^[0-9a-f]{16}$/);
  const nothing = await submitRun(store, "flap", { ...body, ticket: await issueTicket("flap", T0, secret), moves: [0], player: "b".repeat(20) }, T0 + 5000, secret);
  assert.equal(nothing.standing, null, "nothing scored, nothing kept");
  assert.equal(nothing.boards.all.length, 1);
});

/* -------------------------------------------------------------- versus */

await check("versus: the same seed for everyone each round, best score wins it, first to the target wins the match", () => {
  const events: VersusEvent[] = [
    { k: "create", t: T0, code: "BCDF", salt: "salt", game: "flap", settings: { to: 3 } },
    { k: "join", t: T0, p: "a", name: "ann", tok: "x" },
    { k: "join", t: T0, p: "b", name: "ben", tok: "y" },
    { k: "start", t: T0 + 10, p: "b" },
  ];
  assert.equal(phaseOf(reduce(events, T0 + 20)!), "lobby", "only the host starts");
  events.push({ k: "start", t: T0 + 20, p: "a" });
  let room = reduce(events, T0 + 30)!;
  assert.equal(phaseOf(room), "countdown");
  const start = T0 + 20 + COUNTDOWN_MS;
  assert.equal(room.match!.round.seed, seedFor("salt", 1, 1));
  assert.notEqual(seedFor("salt", 1, 2), seedFor("salt", 1, 1));
  assert.equal(phaseOf(reduce(events, start)!), "playing");
  events.push({ k: "finish", t: start + 5000, p: "a", match: 1, round: 1, score: 3, length: 300 });
  assert.equal(phaseOf(reduce(events, start + 5000)!), "playing", "ben's still going");
  events.push({ k: "finish", t: start + 9000, p: "b", match: 1, round: 1, score: 7, length: 500 });
  room = reduce(events, start + 9000)!;
  assert.equal(phaseOf(room), "results");
  assert.equal(room.match!.round.winner, "b");
  assert.deepEqual(viewOf(room, start + 9000).players.map((p) => p.wins), [0, 1]);

  // A draw: the same score and the same length.
  events.push({ k: "start", t: start + 10_000, p: "a" });
  const start2 = start + 10_000 + COUNTDOWN_MS;
  events.push({ k: "finish", t: start2 + 100, p: "a", match: 1, round: 2, score: 4, length: 400 }, { k: "finish", t: start2 + 200, p: "b", match: 1, round: 2, score: 4, length: 400 });
  room = reduce(events, start2 + 300)!;
  assert.equal(room.match!.round.winner, null);
  // Level on score, the longer run takes it.
  events.push({ k: "start", t: start2 + 1000, p: "a" });
  const start3 = start2 + 1000 + COUNTDOWN_MS;
  events.push({ k: "finish", t: start3 + 100, p: "a", match: 1, round: 3, score: 4, length: 400 }, { k: "finish", t: start3 + 200, p: "b", match: 1, round: 3, score: 4, length: 401 });
  room = reduce(events, start3 + 300)!;
  assert.equal(room.match!.round.winner, "b");
  assert.equal(phaseOf(room), "results");
  // A third, and ben's won the match.
  events.push({ k: "start", t: start3 + 1000, p: "a" });
  const start4 = start3 + 1000 + COUNTDOWN_MS;
  events.push({ k: "finish", t: start4 + 100, p: "a", match: 1, round: 4, score: 0, length: 40 }, { k: "finish", t: start4 + 200, p: "b", match: 1, round: 4, score: 1, length: 90 });
  room = reduce(events, start4 + 300)!;
  assert.equal(phaseOf(room), "over");
  assert.equal(room.match!.winner, "b");
  // Starting again is a new match.
  events.push({ k: "start", t: start4 + 1000, p: "a" });
  room = reduce(events, start4 + 1100)!;
  assert.equal(room.match!.index, 2);
  assert.equal(room.match!.wins.size, 0);
});

await check("versus: whoever leaves isn't waited for, and the clock ends a round whatever happens", () => {
  const events: VersusEvent[] = [
    { k: "create", t: T0, code: "BCDF", salt: "salt", game: "snake", settings: { to: 3 } },
    { k: "join", t: T0, p: "a", name: "ann", tok: "x" },
    { k: "join", t: T0, p: "b", name: "ben", tok: "y" },
    { k: "join", t: T0, p: "c", name: "cat", tok: "z" },
    { k: "start", t: T0 + 1, p: "a" },
  ];
  const start = T0 + 1 + COUNTDOWN_MS;
  events.push({ k: "join", t: start + 1, p: "d", name: "dan", tok: "w" }, { k: "finish", t: start + 2, p: "d", match: 1, round: 1, score: 99, length: 9 });
  events.push({ k: "finish", t: start + 1000, p: "a", match: 1, round: 1, score: 2, length: 50 }, { k: "leave", t: start + 2000, p: "b", why: "left", by: "b" });
  let room = reduce(events, start + 2000)!;
  assert.equal(phaseOf(room), "playing", "cat's still going");
  assert.equal(room.match!.round.results.has("d"), false, "dan came too late for this one");
  room = reduce(events, start + ROUND_MS.snake + GRACE_MS)!;
  assert.equal(phaseOf(room), "results");
  assert.equal(room.match!.round.winner, "a");
});

async function versus(store: RoomStore<VersusEvent>, clock: { now: number }) {
  const created = await createRoom(store, "flap", { name: "ann" }, clock.now);
  const code = created.room.code;
  assert.match(code, CODE_PATTERN);
  const joined = await act(store, "flap", code, { type: "join", name: "ben" }, clock.now);
  const seats: { who: Identity; key: string }[] = [
    { who: created.you!, key: created.key! },
    { who: joined.you!, key: joined.key! },
  ];
  const as = (i: number, body: Record<string, unknown>) => act(store, "flap", code, { ...body, player: seats[i].who.id, token: seats[i].who.token }, clock.now);
  const say = async (i: number, data: string, by = i) => live(store, "flap", code, { player: seats[i].who.id, data, mac: await sign(seats[by].key, "live", seats[i].who.id, data) }, clock.now);
  await assert.rejects(getRoom(store, "snake", code, clock.now), fails(404), "a flap room isn't a snake room");
  await assert.rejects(as(1, { type: "start" }), fails(403));
  let reply = await as(0, { type: "start" });
  const round = reply.room.match!.round;
  assert.equal(reply.room.phase, "countdown");
  await assert.rejects(as(0, { type: "start" }), fails(409));

  clock.now = round.startAt;
  assert.deepEqual(await say(0, "k10y200"), { now: clock.now, live: {} });
  assert.deepEqual(await say(1, "k12y180"), { now: clock.now, live: { [seats[0].who.id]: { data: "k10y200", t: clock.now } } });
  await assert.rejects(say(1, "forged", 0), fails(401), "signed with someone else's key");
  clock.now += LIVE_FRESH_MS;
  assert.deepEqual((await say(1, "k20y180")).live, {}, "anyone quiet a while is left out");

  // ann plays it out for real; ben claims more than time allows.
  const { bird, flaps } = flapBot(round.seed);
  await assert.rejects(as(1, { type: "finish", match: 1, round: 1, moves: flaps }), fails(409), "quicker than it could have been played");
  clock.now = round.startAt + bird.tick * flap.TICK_MS;
  reply = await as(0, { type: "finish", match: 1, round: 1, moves: flaps });
  assert.deepEqual(reply.room.match!.round.results[seats[0].who.id], { score: bird.score, length: bird.tick, t: clock.now });
  await assert.rejects(as(0, { type: "finish", match: 1, round: 1, moves: flaps }), fails(409), "only once");
  reply = await as(1, { type: "finish", match: 1, round: 1, moves: [0] });
  assert.equal(reply.room.phase, "results");
  assert.equal(reply.room.match!.round.winner, seats[0].who.id);
  assert.deepEqual(reply.room.players.map((p) => p.wins), [1, 0]);
  await as(1, { type: "leave" });
  await assert.rejects(as(0, { type: "start" }), fails(409), "nobody left to play");
  await assert.rejects(getRoom(store, "flap", "ZZZZ", clock.now), fails(404));
  return code;
}

await check("versus: the API plays a round through, live updates signed, runs played back, in memory", async () => {
  const clock = { now: T0 };
  await versus(new MemoryStore<VersusEvent>(() => clock.now), clock);
});

await check("and through Upstash's REST protocol", async () => {
  const upstash = await fakeUpstash("secret");
  try {
    const clock = { now: T0 };
    const code = await versus(new UpstashStore<VersusEvent>(upstash.url, "secret", "flap"), clock);
    assert.ok(upstash.lists.get(`flap:room:${code}:log`)!.length >= 6);
    assert.equal(upstash.hashes.get(`flap:room:${code}:live`)!.size, 2);
  } finally {
    await upstash.close();
  }
});

console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} arcade checks passed`);
