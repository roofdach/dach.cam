/**
 * Checks for /sus: the ship and walking about it, who's an impostor and
 * what everyone gets to know, zones and vents, tasks, kills and bodies,
 * sabotage, meetings, votes and every way to win, then the API against
 * memory and a pretend Upstash: sealed views, and where everyone's
 * standing, signed. `npm run check` runs it after hang's.
 */

import assert from "node:assert/strict";

import { unseal } from "../lib/draw/secret.ts";
import {
  BUTTON_MS,
  DEFAULT_SETTINGS,
  EJECT_MS,
  FIRST_KILL_MS,
  MEETINGS,
  REACTOR_MS,
  ROLES_MS,
  SABOTAGE_MS,
  ZONE_QUIET_MS,
  cleanSettings,
  impostorsFor,
  phaseOf,
  privateView,
  reduce,
  tasksFor,
  viewOf,
  type Settings,
  type SusEvent,
} from "../lib/sus/room.ts";
import { POS_FRESH_MS, act, createRoom, getRoom, pos, seatKey, sign, type Identity, type Mine, type SusView } from "../lib/sus/server/rooms.ts";
import { CAMERAS, COLS, COLORS, NEXT, ROWS, SEATS, SPOTS, TASKS, TILE, VENTS, ZONE_IDS, centerOf, hops, zoneAt, zoneOfTile, type ZoneId } from "../lib/sus/ship.ts";
import { RADIUS, WALLS, canSee, fits, sightLine, step, visibility } from "../lib/sus/space.ts";
import { CODE_PATTERN } from "../lib/rooms/codes.ts";
import { RoomError } from "../lib/rooms/http.ts";
import { MemoryStore, UpstashStore, type RoomStore } from "../lib/rooms/store.ts";
import { fakeUpstash } from "./fake-upstash.mts";

const results: string[] = [];
async function check(name: string, body: () => void | Promise<void>) {
  await body();
  results.push(name);
}

const T0 = Date.UTC(2026, 8, 29, 18);
const PLAY = T0 + ROLES_MS;
const fails = (status: number) => (e: unknown) => e instanceof RoomError && e.status === status;

/** The zones between two, the shortest way. */
function route(from: ZoneId, to: ZoneId): ZoneId[] {
  const back = new Map<ZoneId, ZoneId>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const here = queue.shift()!;
    for (const next of NEXT[here]) {
      if (back.has(next)) continue;
      back.set(next, here);
      queue.push(next);
    }
  }
  const path: ZoneId[] = [];
  for (let z = to; z !== from; z = back.get(z)!) path.unshift(z);
  return path;
}

/* ---------------------------------------------------------------- ship */

await check("the ship holds together: all its floor joined up, and everything where it should be", () => {
  const start = { c: Math.floor(SEATS[0].x / TILE), r: Math.floor(SEATS[0].y / TILE) };
  const seen = new Set([`${start.c},${start.r}`]);
  const queue = [start];
  while (queue.length) {
    const { c, r } = queue.shift()!;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { c: c + dc, r: r + dr };
      if (seen.has(`${next.c},${next.r}`) || !fits((next.c + 0.5) * TILE, (next.r + 0.5) * TILE)) continue;
      seen.add(`${next.c},${next.r}`);
      queue.push(next);
    }
  }
  let floor = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (zoneOfTile(c, r)) floor++;
  assert.equal(seen.size, floor, "a crewmate can stand on every tile of floor, and walk there from the cafeteria");
  for (const zone of ZONE_IDS) {
    assert.ok(NEXT[zone].length > 0, `${zone} has a way in`);
    for (const next of NEXT[zone]) assert.ok(NEXT[next].includes(zone));
    assert.equal(zoneAt(centerOf(zone).x, centerOf(zone).y), zone);
  }
  assert.deepEqual([...NEXT.cafeteria].sort(), ["hall-central", "hall-upper", "hall-weapons"]);
  assert.equal(hops("cafeteria", "reactor"), 4);
  for (const task of TASKS) assert.ok(zoneAt(task.x, task.y) === task.room && fits(task.x, task.y), `${task.id} is in ${task.room}`);
  for (const vent of VENTS) {
    assert.ok(zoneAt(vent.x, vent.y) === vent.zone && fits(vent.x, vent.y), `the ${vent.id} vent`);
    for (const link of vent.links) assert.ok(VENTS.find((v) => v.id === link)!.links.includes(vent.id), `${vent.id} and ${link} go both ways`);
  }
  for (const spot of [SPOTS.button, SPOTS.table, SPOTS.cameras, SPOTS.lights, ...SPOTS.reactor]) assert.ok(zoneAt(spot.x, spot.y) === spot.zone && fits(spot.x, spot.y));
  assert.equal(SEATS.length, COLORS.length);
  for (const seat of SEATS) assert.ok(zoneAt(seat.x, seat.y) === "cafeteria" && fits(seat.x, seat.y), "everyone has a seat");
  for (const camera of CAMERAS) assert.ok(zoneAt(camera.x + camera.w / 2, camera.y + camera.h / 2), `the ${camera.id} camera looks at floor`);
});

await check("walking: walls stop you and you slide along them; ghosts go through; you can't see through walls", () => {
  const start = { x: SPOTS.button.x, y: SPOTS.button.y };
  const stopped = step(start, 0, -2000);
  assert.ok(stopped.x === start.x && stopped.y >= TILE + RADIUS && stopped.y < TILE + RADIUS + 8, "up to the cafeteria's top wall, and no further");
  const slid = step({ x: start.x, y: TILE + RADIUS }, 200, -200);
  assert.ok(Math.abs(slid.x - (start.x + 200)) < 1e-6 && slid.y === TILE + RADIUS, "along it, sideways");
  assert.ok(step(start, 0, -2000, true).y < TILE, "a ghost goes through");
  // From the upper corridor, down the stub into medbay.
  let p = { x: 1250, y: 300 };
  for (let i = 0; i < 60; i++) p = step(p, 0, 10);
  assert.equal(zoneAt(p.x, p.y), "medbay");
  assert.ok(WALLS.length > 50);
  assert.ok(sightLine({ x: 1600, y: 100 }, { x: 2200, y: 580 }), "across the cafeteria");
  assert.ok(!sightLine(start, centerOf("medbay")), "not through a wall");
  assert.ok(canSee(start, { x: start.x + 200, y: start.y }, 380) && !canSee(start, { x: start.x + 400, y: start.y }, 380), "not too far");
  const seen = visibility(start, 380);
  assert.ok(seen.length > 72 && seen.every((q) => Math.hypot(q.x - start.x, q.y - start.y) <= 380 + 1e-6));
});

await check("settings are checked, and big rooms get more impostors", () => {
  assert.deepEqual(cleanSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, kill: 10 }), null);
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, meeting: "forever" }), null);
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, confirm: "yes" }), null);
  assert.deepEqual([4, 6, 7, 8, 9, 15].map((n) => impostorsFor(n, 3)), [1, 1, 2, 2, 3, 3]);
  assert.equal(impostorsFor(10, 1), 1, "never more than the host asked for");
  const tasks = tasksFor("salt", 1, "a", 5);
  assert.equal(new Set(tasks.map((t) => t.kind)).size, 5, "five different kinds of job");
  assert.deepEqual(tasksFor("salt", 1, "a", 5), tasks);
  assert.notDeepEqual(tasksFor("salt", 1, "b", 5), tasks, "everyone has their own");
});

/* --------------------------------------------------------------- rules */

const create = (settings: Partial<Settings> = {}): SusEvent => ({ k: "create", t: T0, code: "BCDF", salt: "salt", settings: { ...DEFAULT_SETTINGS, ...settings } });
const join = (p: string, t = T0): SusEvent => ({ k: "join", t, p, name: p, tok: `tok-${p}` });
const zone = (p: string, t: number, to: ZoneId): SusEvent => ({ k: "zone", t, p, game: 1, zone: to });

/** Walks someone zone by zone, a zone every 800ms after `t`; returns when they get there. */
function walk(events: SusEvent[], p: string, t: number, from: ZoneId, to: ZoneId): number {
  for (const next of route(from, to)) events.push(zone(p, (t += 800), next));
  return t;
}

/** A game of `n` started at T0, with who turned out to be what. */
function started(n = 5, settings: Partial<Settings> = {}) {
  const ids = "abcdefghij".slice(0, n).split("");
  const events: SusEvent[] = [create(settings), ...ids.map((p) => join(p)), { k: "start", t: T0, p: "a" }];
  const room = reduce(events, T0)!;
  const agents = [...room.game!.agents.values()];
  return { events, imp: agents.find((a) => a.impostor)!.id, crew: agents.filter((a) => !a.impostor).map((a) => a.id) };
}

await check("a game starts with roles only the impostor's own view shows", () => {
  const { events, imp, crew } = started(5);
  let room = reduce(events, T0)!;
  assert.equal(phaseOf(room), "roles");
  assert.equal(room.game!.impostors, 1);
  assert.equal(privateView(room, imp)!.impostor, true);
  assert.equal(privateView(room, crew[0])!.impostor, false);
  const view = JSON.stringify(viewOf(room, T0));
  assert.ok(!view.includes('"impostor":true') && !view.includes("cafeteria") && !view.includes("salt"), "the shared view gives nothing away");
  room = reduce(events, PLAY)!;
  assert.equal(phaseOf(room), "action");
  assert.equal(viewOf(room, PLAY).game!.round, 1);
  assert.ok([...room.game!.agents.values()].every((a) => a.zone === "cafeteria"));
  const two = started(8, { impostors: 2 });
  const pair = [...reduce(two.events, T0)!.game!.agents.values()].filter((a) => a.impostor).map((a) => a.id);
  assert.equal(pair.length, 2);
  assert.deepEqual(privateView(reduce(two.events, T0)!, pair[0])!.mates, [pair[1]], "impostors know each other");
});

await check("zones: a zone or two on at a time, further after a quiet spell; vents for impostors only", () => {
  const { events, imp, crew } = started(5);
  const [c1, c2] = crew;
  events.push(zone(c1, PLAY + 100, "storage"));
  assert.equal(reduce(events, PLAY + 100)!.game!.agents.get(c1)!.zone, "storage", "two on: the admin corridor, then storage");
  events.push(zone(c1, PLAY + 200, "navigation"));
  assert.equal(reduce(events, PLAY + 200)!.game!.agents.get(c1)!.zone, "storage", "navigation is four further still");
  events.push(zone(c2, PLAY + 300, "electrical"));
  assert.equal(reduce(events, PLAY + 300)!.game!.agents.get(c2)!.zone, "cafeteria", "four away, straight off");
  events.push(zone(c2, PLAY + ZONE_QUIET_MS, "electrical"));
  assert.equal(reduce(events, PLAY + ZONE_QUIET_MS)!.game!.agents.get(c2)!.zone, "electrical", "but after a quiet spell, a word may have gone missing");
  events.push({ k: "vent", t: PLAY + 3000, p: c1, game: 1, from: "cafeteria", to: "admin" });
  events.push({ k: "vent", t: PLAY + 3000, p: imp, game: 1, from: "admin", to: "cafeteria" });
  events.push({ k: "vent", t: PLAY + 3000, p: imp, game: 1, from: "cafeteria", to: "navigation" });
  let room = reduce(events, PLAY + 3000)!;
  assert.equal(room.game!.agents.get(imp)!.zone, "cafeteria", "only from a vent where you are, to one it goes to");
  events.push({ k: "vent", t: PLAY + 3100, p: imp, game: 1, from: "cafeteria", to: "admin" });
  room = reduce(events, PLAY + 3100)!;
  assert.equal(room.game!.agents.get(imp)!.zone, "admin");
  assert.deepEqual(privateView(room, imp)!.table, { admin: 1, cafeteria: 2, storage: 1, electrical: 1 }, "admin shows how many are where");
  assert.equal(privateView(room, crew[2])!.table, null);
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS, p: imp, game: 1, target: crew[3], x: 0, y: 0 });
  room = reduce(events, PLAY + FIRST_KILL_MS)!;
  assert.equal(room.game!.agents.get(crew[3])!.alive, true, "a kill needs them in the same zone or the next: the cafeteria's two from admin");
});

await check("tasks take their time, in the right zone; the scan is seen, and impostors can't do it", () => {
  const { events, crew } = started(4);
  let room = reduce(events, PLAY)!;
  const worker = crew[0];
  const task = TASKS.find((x) => x.id === room.game!.agents.get(worker)!.tasks[0].id)!;
  const arrived = walk(events, worker, PLAY, "cafeteria", task.room);
  if (task.kind === "scan") events.push({ k: "begin", t: arrived, p: worker, game: 1, task: task.id });
  events.push({ k: "task", t: arrived + task.min - 1, p: worker, game: 1, task: task.id });
  room = reduce(events, arrived + task.min - 1)!;
  assert.equal(room.game!.agents.get(worker)!.tasks[0].done, false, "too quick");
  events.push({ k: "task", t: arrived + task.min, p: worker, game: 1, task: task.id });
  room = reduce(events, arrived + task.min)!;
  assert.equal(room.game!.agents.get(worker)!.tasks[0].done, true);
  assert.equal(viewOf(room, arrived + task.min).game!.tasks.done, 1);
  assert.equal(viewOf(room, arrived + task.min).game!.tasks.total, 5 * 3, "only the crew's tasks count");

  // Find a game where a crewmate has the scan, and watch them do it.
  const game = [4, 5, 6, 7, 8].map((n) => started(n, { tasks: 7 })).find((g) => g.crew.some((c) => reduce(g.events, PLAY)!.game!.agents.get(c)!.tasks.some((t) => t.id === "scan")))!;
  const tasks = (id: string) => reduce(game.events, PLAY)!.game!.agents.get(id)!.tasks;
  const scanner = game.crew.find((c) => tasks(c).some((t) => t.id === "scan"))!;
  const watcher = game.crew.find((c) => c !== scanner)!;
  for (const p of [scanner, watcher, game.imp]) walk(game.events, p, PLAY, "cafeteria", "medbay");
  game.events.push({ k: "task", t: PLAY + 9000, p: scanner, game: 1, task: "scan" });
  room = reduce(game.events, PLAY + 9000)!;
  assert.equal(room.game!.agents.get(scanner)!.tasks.find((t) => t.id === "scan")!.done, false, "no scan without getting on the scanner");
  game.events.push({ k: "begin", t: PLAY + 9000, p: scanner, game: 1, task: "scan" }, { k: "begin", t: PLAY + 9000, p: game.imp, game: 1, task: "scan" });
  room = reduce(game.events, PLAY + 9000)!;
  assert.deepEqual(privateView(room, watcher)!.scanning, [scanner], "everyone near can see who's on the scanner, and it's never the impostor");
  const away = [...game.events, zone(watcher, PLAY + 9100, "hall-upper"), zone(watcher, PLAY + 9900, "cafeteria")];
  assert.deepEqual(privateView(reduce(away, PLAY + 9900)!, watcher)!.scanning, [], "but not from the cafeteria");
  game.events.push({ k: "task", t: PLAY + 17_000, p: scanner, game: 1, task: "scan" });
  assert.equal(reduce(game.events, PLAY + 17_000)!.game!.agents.get(scanner)!.tasks.find((t) => t.id === "scan")!.done, true);
});

await check("the whole crew's tasks done wins it", () => {
  const { events, crew } = started(4, { tasks: 3 });
  const room = reduce(events, PLAY)!;
  let t = PLAY;
  for (const id of crew) {
    let at: ZoneId = "cafeteria";
    for (const task of room.game!.agents.get(id)!.tasks.map((x) => TASKS.find((y) => y.id === x.id)!)) {
      t = walk(events, id, t, at, task.room);
      at = task.room;
      if (task.kind === "scan") events.push({ k: "begin", t: (t += 100), p: id, game: 1, task: task.id });
      events.push({ k: "task", t: (t += task.min + 100), p: id, game: 1, task: task.id });
    }
  }
  const end = reduce(events, t)!;
  assert.equal(phaseOf(end), "over");
  assert.deepEqual(end.game!.result, { winner: "crew", why: "tasks" });
  assert.deepEqual(viewOf(end, t).game!.tasks, { done: 9, total: 9 });
});

await check("kills: not straight away, only who's close, and the body lies where it fell", () => {
  const { events, imp, crew } = started(6);
  const [victim, near, far] = crew;
  events.push({ k: "kill", t: PLAY + 5000, p: imp, game: 1, target: victim, x: 1800, y: 300 });
  let room = reduce(events, PLAY + 5000)!;
  assert.equal(room.game!.agents.get(victim)!.alive, true, "not before the first cooldown");
  events.push(zone(far, PLAY + 6000, "hall-upper"), zone(far, PLAY + 6800, "medbay"));
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS, p: imp, game: 1, target: victim, x: 1800, y: 300 });
  room = reduce(events, PLAY + FIRST_KILL_MS)!;
  assert.equal(room.game!.agents.get(victim)!.alive, false);
  assert.deepEqual(room.game!.bodies[0], { victim, zone: "cafeteria", x: 1800, y: 300, at: PLAY + FIRST_KILL_MS });
  assert.equal(privateView(room, victim)!.killer, imp, "you know who did it");
  assert.deepEqual(privateView(room, near)!.bodies, [{ victim, x: 1800, y: 300 }]);
  assert.deepEqual(privateView(room, far)!.bodies, [{ victim, x: 1800, y: 300 }], "two zones away, you might see it");
  assert.equal(viewOf(room, PLAY + FIRST_KILL_MS).players.find((p) => p.id === victim)!.dead, false, "nobody's told yet");
  assert.deepEqual(privateView(room, victim)!.dead, []);

  // The next one said to be somewhere silly, so it lands in the middle of the victim's zone.
  const second = PLAY + FIRST_KILL_MS + DEFAULT_SETTINGS.kill * 1000;
  events.push(join("z", second - 1), { k: "kill", t: second, p: imp, game: 1, target: near, x: 50, y: 50 });
  room = reduce(events, second)!;
  assert.deepEqual(room.game!.bodies.at(-1), { victim: near, zone: "cafeteria", ...centerOf("cafeteria"), at: second });
  assert.equal(room.game!.agents.has("z"), false, "someone arriving midway waits for the next game");
  assert.deepEqual(privateView(room, victim)!.dead, [near], "a ghost knows who else is a ghost");
  events.push(zone(far, second + 1000, "hall-upper"), zone(far, second + 2000, "upper"), zone(far, second + 3000, "hall-left"));
  room = reduce(events, second + 3000)!;
  assert.deepEqual(privateView(room, far)!.bodies, [], "bodies further off aren't in your view");
  assert.equal(privateView(room, victim)!.bodies.length, 2, "a ghost sees them all");
});

await check("the impostors win once there are as many of them as crew", () => {
  const { events, imp, crew } = started(4);
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS, p: imp, game: 1, target: crew[0], x: 1900, y: 325 });
  let room = reduce(events, PLAY + FIRST_KILL_MS)!;
  assert.equal(phaseOf(room), "action", "one impostor and two crew left");
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS + 30_000, p: imp, game: 1, target: crew[1], x: 1900, y: 325 });
  room = reduce(events, PLAY + FIRST_KILL_MS + 30_000)!;
  assert.equal(phaseOf(room), "over");
  assert.deepEqual(room.game!.result, { winner: "impostors", why: "outnumbered" });
  const view = viewOf(room, PLAY + FIRST_KILL_MS + 30_000);
  assert.deepEqual(view.game!.result!.impostors, [imp], "and everyone finds out who it was");
  assert.equal(view.players.find((p) => p.id === imp)!.impostor, true);
  assert.ok(crew.slice(0, 2).every((id) => view.players.find((p) => p.id === id)!.dead), "and who died, found or not");
});

await check("a body found calls a meeting: the dead are shown, then a vote, an ejection, and the end", () => {
  const { events, imp, crew } = started(6);
  const [victim, finder, a, b] = crew;
  const start = PLAY + FIRST_KILL_MS + 1000;
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS, p: imp, game: 1, target: victim, x: 1900, y: 325 });
  events.push(zone(a, PLAY + FIRST_KILL_MS + 100, "hall-upper"), zone(a, PLAY + FIRST_KILL_MS + 900, "medbay"));
  events.push({ k: "report", t: start, p: a, game: 1, body: victim });
  assert.equal(phaseOf(reduce(events, start)!), "action", "not from two zones away");
  events.push({ k: "report", t: start, p: finder, game: 1, body: victim });
  let room = reduce(events, start)!;
  assert.equal(phaseOf(room), "meeting");
  let view = viewOf(room, start);
  assert.deepEqual([view.game!.meeting!.caller, view.game!.meeting!.body, view.game!.meeting!.where], [finder, victim, "cafeteria"]);
  assert.equal(view.players.find((p) => p.id === victim)!.dead, true, "the dead are shown at the table");
  const { discuss, vote } = MEETINGS.normal;
  events.push({ k: "vote", t: start + 1000, p: a, game: 1, meeting: 1, for: imp });
  assert.equal(reduce(events, start + 1000)!.game!.agents.get(a)!.vote, null, "no voting while it's talked over");
  const open = start + discuss * 1000;
  // The dead can't vote, and nobody votes twice.
  events.push({ k: "vote", t: open, p: victim, game: 1, meeting: 1, for: imp });
  events.push({ k: "vote", t: open, p: a, game: 1, meeting: 1, for: imp }, { k: "vote", t: open, p: b, game: 1, meeting: 1, for: imp });
  events.push({ k: "vote", t: open + 1, p: a, game: 1, meeting: 1, for: "skip" });
  room = reduce(events, open + 1)!;
  view = viewOf(room, open + 1);
  assert.deepEqual(view.game!.meeting!.voted.sort(), [a, b].sort(), "who's voted, not for whom");
  events.push({ k: "vote", t: open + 2000, p: finder, game: 1, meeting: 1, for: "skip" }, { k: "vote", t: open + 2000, p: imp, game: 1, meeting: 1, for: finder });
  assert.equal(phaseOf(reduce(events, open + 2000)!), "meeting", "one still to vote");
  const end = start + (discuss + vote) * 1000;
  room = reduce(events, end)!;
  assert.equal(phaseOf(room), "ejection", "time's up");
  view = viewOf(room, end);
  assert.equal(view.game!.ejection!.ejected, imp);
  assert.deepEqual([view.game!.ejection!.impostor, view.game!.ejection!.remaining], [true, 0]);
  assert.equal(view.game!.ejection!.votes[a], imp);
  assert.equal(view.game!.result, null, "the end waits for the ejection");
  room = reduce(events, end + EJECT_MS)!;
  assert.equal(phaseOf(room), "over");
  assert.deepEqual(room.game!.result, { winner: "crew", why: "votes" });
});

await check("a tie or a skip ejects nobody; the button works once each, from the cafeteria, and not straight away", () => {
  const { events, imp, crew } = started(5, { meeting: "short" });
  events.push({ k: "button", t: PLAY + 1000, p: crew[0], game: 1 });
  assert.equal(phaseOf(reduce(events, PLAY + 1000)!), "action", "the button needs a moment");
  events.push({ k: "button", t: PLAY + BUTTON_MS, p: crew[0], game: 1 });
  assert.equal(phaseOf(reduce(events, PLAY + BUTTON_MS)!), "meeting");
  const open = PLAY + BUTTON_MS + MEETINGS.short.discuss * 1000;
  const votes: [string, string][] = [
    [crew[0], imp],
    [crew[1], imp],
    [imp, crew[2]],
    [crew[2], crew[3]],
    [crew[3], crew[2]],
  ];
  for (const [p, choice] of votes) events.push({ k: "vote", t: open, p, game: 1, meeting: 1, for: choice });
  let view = viewOf(reduce(events, open)!, open);
  assert.deepEqual([view.game!.ejection!.ejected, view.game!.ejection!.tie], [null, true]);
  const back = open + EJECT_MS;
  const room = reduce(events, back)!;
  assert.equal(phaseOf(room), "action");
  assert.equal(viewOf(room, back).game!.round, 2, "back round the table");
  assert.ok([...room.game!.agents.values()].every((a) => a.zone === "cafeteria"));
  assert.equal(room.game!.agents.get(imp)!.killAt, back + DEFAULT_SETTINGS.kill * 1000, "the kill cooldown starts again");
  events.push(zone(crew[1], back + 100, "hall-weapons"));
  events.push({ k: "button", t: back + BUTTON_MS, p: crew[0], game: 1 }, { k: "button", t: back + BUTTON_MS, p: crew[1], game: 1 });
  assert.equal(phaseOf(reduce(events, back + BUTTON_MS)!), "action", "one each, and from the cafeteria");
  events.push({ k: "button", t: back + BUTTON_MS, p: crew[2], game: 1 });
  assert.equal(phaseOf(reduce(events, back + BUTTON_MS)!), "meeting");
  const second = back + BUTTON_MS + MEETINGS.short.discuss * 1000;
  for (const p of [imp, ...crew]) events.push({ k: "vote", t: second, p, game: 1, meeting: 2, for: p === crew[0] ? crew[3] : "skip" });
  view = viewOf(reduce(events, second)!, second);
  assert.deepEqual([view.game!.ejection!.ejected, view.game!.ejection!.skipped], [null, true]);

  const quiet = started(5, { meeting: "short", confirm: false });
  quiet.events.push({ k: "button", t: PLAY + BUTTON_MS, p: quiet.crew[0], game: 1 });
  for (const p of [quiet.imp, ...quiet.crew]) quiet.events.push({ k: "vote", t: PLAY + BUTTON_MS + 15_000, p, game: 1, meeting: 1, for: quiet.crew[3] });
  view = viewOf(reduce(quiet.events, PLAY + BUTTON_MS + 15_000)!, 0);
  assert.equal(view.game!.ejection!.ejected, quiet.crew[3]);
  assert.deepEqual([view.game!.ejection!.impostor, view.game!.ejection!.remaining], [null, null], "with confirm off, not what they were");
});

await check("sabotage: the lights are fixed in electrical, the reactor by two hands at once, or it melts down", () => {
  const { events, imp, crew } = started(5);
  const at = PLAY + 10_000;
  events.push({ k: "sabotage", t: at, p: imp, game: 1, kind: "reactor" });
  assert.equal(viewOf(reduce(events, at)!, at).game!.sabotage!.ends, at + REACTOR_MS);
  assert.equal(phaseOf(reduce([...events, { k: "button", t: at + BUTTON_MS, p: crew[0], game: 1 }], at + BUTTON_MS)!), "action", "no button during a meltdown");
  for (const p of crew.slice(0, 2)) walk(events, p, at, "cafeteria", "reactor");
  events.push({ k: "fix", t: at + 6000, p: crew[0], game: 1, kind: "reactor" });
  let room = reduce(events, at + 6000)!;
  assert.equal(viewOf(room, at + 6000).game!.sabotage!.hands, 1);
  events.push({ k: "fix", t: at + 7000, p: crew[1], game: 1, kind: "reactor" });
  room = reduce(events, at + 7000)!;
  assert.equal(room.game!.sabotage, null, "two hands");
  assert.equal(room.game!.sabotageAt, at + 7000 + SABOTAGE_MS);
  events.push({ k: "sabotage", t: at + 8000, p: imp, game: 1, kind: "lights" });
  assert.equal(reduce(events, at + 8000)!.game!.sabotage, null, "not again so soon");
  const lights = at + 7000 + SABOTAGE_MS;
  events.push({ k: "sabotage", t: lights, p: imp, game: 1, kind: "lights" });
  room = reduce(events, lights)!;
  assert.equal(privateView(room, crew[2])!.dark, true);
  assert.equal(privateView(room, imp)!.dark, false, "impostors see in the dark");
  const fixedAt = walk(events, crew[2], lights, "cafeteria", "electrical");
  events.push({ k: "fix", t: fixedAt, p: crew[2], game: 1, kind: "lights" });
  assert.equal(reduce(events, fixedAt)!.game!.sabotage, null, "lights back on");

  const melt = started(5);
  melt.events.push({ k: "sabotage", t: at, p: melt.imp, game: 1, kind: "reactor" });
  assert.deepEqual(reduce(melt.events, at + REACTOR_MS)!.game!.result, { winner: "impostors", why: "reactor" });
});

await check("leaving: the crew's tasks go with them, and the impostor going ends it", () => {
  const { events, imp, crew } = started(5, { tasks: 3 });
  events.push({ k: "leave", t: PLAY + 1000, p: crew[0], why: "left" });
  assert.equal(viewOf(reduce(events, PLAY + 1000)!, PLAY + 1000).game!.tasks.total, 9);
  events.push({ k: "leave", t: PLAY + 2000, p: imp, why: "gone" });
  assert.deepEqual(reduce(events, PLAY + 2000)!.game!.result, { winner: "crew", why: "left" });
});

/* ----------------------------------------------------------------- api */

const open = async (key: string, view: SusView, id: string): Promise<Mine | null> => {
  const sealed = view.seals[id];
  const text = sealed && (await unseal(key, sealed.iv, sealed.box));
  return text ? (JSON.parse(text) as Mine) : null;
};

async function playThrough(store: RoomStore<SusEvent>, clock: { now: number }) {
  const created = await createRoom(store, { name: "ann" }, clock.now);
  const code = created.room.code;
  assert.match(code, CODE_PATTERN);
  const seats: { who: Identity; key: string }[] = [{ who: created.you!, key: created.key! }];
  for (const name of ["ben", "cat", "dan", "eve"]) {
    const reply = await act(store, code, { type: "join", name }, clock.now);
    seats.push({ who: reply.you!, key: reply.key! });
  }
  const as = (i: number, body: Record<string, unknown>) => act(store, code, { ...body, player: seats[i].who.id, token: seats[i].who.token }, clock.now);
  const id = (i: number) => seats[i].who.id;
  // Where someone's standing, signed with the key of whoever's at seat `by`.
  const stand = async (i: number, x: number, y: number, by = i) => {
    const data = JSON.stringify({ x, y, f: -1, m: 1, v: 0 });
    return pos(store, code, { type: "pos", player: id(i), data, mac: await sign(seats[by].key, "pos", id(i), data) }, clock.now);
  };

  // Saying where you are hears back where everyone else is.
  assert.deepEqual(await stand(0, 1850.4, 300), { now: clock.now, pos: {}, version: 0 });
  assert.deepEqual(await stand(1, 1900, 400), { now: clock.now, pos: { [id(0)]: { x: 1850, y: 300, f: -1, m: 1, v: 0, t: clock.now } }, version: 0 });
  await assert.rejects(stand(2, 0, 0, 1), fails(401), "signed with someone else's key");
  await assert.rejects(pos(store, code, { type: "pos", player: id(2), data: "{}", mac: await sign(seats[2].key, "pos", id(2), "{}") }, clock.now), fails(400));
  clock.now += POS_FRESH_MS;
  assert.deepEqual(await stand(2, 1000, 1000), { now: clock.now, pos: {}, version: 0 }, "anyone quiet a while is left out");

  await assert.rejects(as(1, { type: "start" }), fails(403));
  await as(0, { type: "settings", settings: { ...DEFAULT_SETTINGS, meeting: "short" } });
  await as(0, { type: "start" });
  let view = await getRoom(store, code, clock.now);
  assert.ok(!JSON.stringify({ ...view, seals: null }).includes('"impostor":true'));
  assert.equal(new Set(Object.values(view.seals).map((s) => s.box.length)).size, 1, "every sealed view is the same size");
  const mines = await Promise.all(seats.map((s) => open(s.key, view, s.who.id)));
  assert.ok(mines.every((m) => m !== null), "everyone can open their own");
  assert.equal(await open(seats[0].key, view, id(1)), null, "and nobody else's");
  const imp = mines.findIndex((m) => m!.impostor);
  const crew = [0, 1, 2, 3, 4].filter((i) => i !== imp);

  clock.now += ROLES_MS;
  let reply = await as(crew[0], { type: "zone", zone: "hall-central" });
  assert.equal(reply.mine!.zone, "hall-central");
  await as(crew[0], { type: "zone", zone: "admin" });
  await assert.rejects(as(crew[1], { type: "zone", zone: "reactor" }), fails(409), "four zones in one go");
  await assert.rejects(as(crew[1], { type: "kill", game: 1, target: id(crew[2]) }), fails(409), "crew can't kill");
  await assert.rejects(as(imp, { type: "kill", game: 1, target: id(crew[1]) }), fails(409), "not yet");
  await assert.rejects(as(crew[1], { type: "say", text: "hi" }), fails(409), "no talking till a meeting");
  clock.now += FIRST_KILL_MS;
  await assert.rejects(as(imp, { type: "kill", game: 1, target: id(crew[0]), x: 2400, y: 1000 }), fails(409), "admin's two away");
  await stand(imp, 1560, 300);
  await stand(crew[1], 1900, 300);
  await assert.rejects(as(imp, { type: "kill", game: 1, target: id(crew[1]), x: 1850, y: 300 }), fails(409), "the same room, but across it");
  assert.equal((await stand(imp, 1830, 320)).version, 0, "walking about isn't news");
  reply = await as(imp, { type: "kill", game: 1, target: id(crew[1]), x: 1850, y: 300 });
  assert.equal((await stand(crew[2], 2000, 300)).version, reply.room.version, "a kill is");
  assert.deepEqual(reply.mine!.bodies, [{ victim: id(crew[1]), x: 1850, y: 300 }]);
  view = await getRoom(store, code, clock.now);
  assert.equal((await open(seats[crew[1]].key, view, id(crew[1])))!.alive, false);
  reply = await as(crew[2], { type: "report", game: 1, body: id(crew[1]) });
  assert.equal(reply.room.game!.phase, "meeting");
  await as(crew[2], { type: "say", text: "i saw it!" });
  await as(crew[1], { type: "say", text: "boo" });
  view = await getRoom(store, code, clock.now);
  assert.deepEqual(view.chat.filter((c) => !c.iv).map((c) => c.text), ["i saw it!"]);
  const ghostLine = view.chat.find((c) => c.iv)!;
  const ghost = await open(seats[crew[1]].key, view, id(crew[1]));
  assert.equal(await unseal(ghost!.ghostKey!, ghostLine.iv!, ghostLine.text), "boo", "the dead's chat, sealed for the dead");
  assert.equal((await open(seats[crew[2]].key, view, id(crew[2])))!.ghostKey, null);
  clock.now += MEETINGS.short.discuss * 1000;
  for (const i of [crew[0], crew[2], crew[3]]) await as(i, { type: "vote", game: 1, meeting: 1, for: id(imp) });
  reply = await as(imp, { type: "vote", game: 1, meeting: 1, for: "skip" });
  assert.equal(reply.room.game!.ejection!.ejected, id(imp));
  clock.now += EJECT_MS;
  view = await getRoom(store, code, clock.now);
  assert.equal(view.game!.result!.winner, "crew");
  await assert.rejects(getRoom(store, "ZZZZ", clock.now), fails(404));
  return code;
}

await check("the API plays a game through, sealed views and signed positions, in memory", async () => {
  const clock = { now: T0 };
  await playThrough(new MemoryStore<SusEvent>(() => clock.now), clock);
});

await check("and through Upstash's REST protocol", async () => {
  const upstash = await fakeUpstash("secret");
  try {
    const clock = { now: T0 };
    const code = await playThrough(new UpstashStore<SusEvent>(upstash.url, "secret", "sus"), clock);
    assert.ok(upstash.lists.get(`sus:room:${code}:log`)!.length > 10);
    assert.equal(upstash.lists.get(`sus:room:${code}:chat`)!.length, 2);
    assert.ok(upstash.hashes.get(`sus:room:${code}:pos`)!.size >= 3);
    assert.ok(upstash.ttls.has(`sus:room:${code}:pos`), "where people stood expires with the room");
  } finally {
    await upstash.close();
  }
});

assert.equal((await seatKey("salt", "a")).length, 44);
console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} sus checks passed`);
