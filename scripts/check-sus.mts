/**
 * Checks for /sus: the ship, who's an impostor and what everyone gets to
 * know, moving and venting, tasks, kills and who sees them, sabotage,
 * meetings, votes and every way to win, then the API against memory and a
 * pretend Upstash, sealed views and all. `npm run check` runs it after hang's.
 */

import assert from "node:assert/strict";

import { unseal } from "../lib/draw/secret.ts";
import {
  BUTTON_MS,
  DEFAULT_SETTINGS,
  EJECT_MS,
  FIRST_KILL_MS,
  MEETINGS,
  MOVE_MS,
  REACTOR_MS,
  ROLES_MS,
  SABOTAGE_MS,
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
import { act, createRoom, getRoom, seatKey, type Identity, type Mine, type SusView } from "../lib/sus/server/rooms.ts";
import { CAMERAS, COLORS, CORRIDORS, ROOM_IDS, TASKS, VENTS, exitsFrom, type RoomId } from "../lib/sus/ship.ts";
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

/* ---------------------------------------------------------------- ship */

await check("the ship holds together: every room can be reached, vents and tasks are in rooms", () => {
  assert.equal(ROOM_IDS.length, 14);
  const reached = new Set<RoomId>(["cafeteria"]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const room of [...reached]) {
      for (const next of exitsFrom(room)) {
        if (reached.has(next)) continue;
        reached.add(next);
        changed = true;
      }
    }
  }
  assert.equal(reached.size, ROOM_IDS.length, "every room from the cafeteria");
  for (const [a, b] of [...CORRIDORS, ...VENTS]) assert.ok(ROOM_IDS.includes(a) && ROOM_IDS.includes(b) && a !== b);
  assert.equal(new Set(CORRIDORS.map(([a, b]) => [a, b].sort().join())).size, CORRIDORS.length, "no corridor twice");
  assert.ok(CAMERAS.every((r) => ROOM_IDS.includes(r)));
  assert.equal(new Set(TASKS.map((t) => t.id)).size, TASKS.length);
  assert.ok(TASKS.every((t) => ROOM_IDS.includes(t.room) && t.min > 0));
  assert.equal(new Set(COLORS.map((c) => c.name)).size, COLORS.length);
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
const move = (p: string, t: number, to: RoomId, vent = false): SusEvent => ({ k: "move", t, p, game: 1, to, ...(vent ? { vent } : {}) });

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
  assert.deepEqual(privateView(room, imp)!.mates, []);
  const view = JSON.stringify(viewOf(room, T0));
  assert.ok(!view.includes('"impostor":true') && !view.includes("cafeteria") && !view.includes("salt"), "the shared view gives nothing away");
  room = reduce(events, PLAY)!;
  assert.equal(phaseOf(room), "action");
  assert.ok([...room.game!.agents.values()].every((a) => a.room === "cafeteria"));
  assert.deepEqual(privateView(room, crew[0])!.here.sort(), [imp, ...crew.slice(1)].sort(), "everyone starts together");
  const two = started(8, { impostors: 2 });
  const pair = [...reduce(two.events, T0)!.game!.agents.values()].filter((a) => a.impostor).map((a) => a.id);
  assert.equal(pair.length, 2);
  assert.deepEqual(privateView(reduce(two.events, T0)!, pair[0])!.mates, [pair[1]], "impostors know each other");
});

/** From the cafeteria to anywhere, a step at a time. */
const PATHS: Record<RoomId, RoomId[]> = {
  cafeteria: [],
  medbay: ["medbay"],
  upper: ["medbay", "upper"],
  reactor: ["medbay", "upper", "reactor"],
  security: ["medbay", "upper", "security"],
  lower: ["medbay", "upper", "reactor", "lower"],
  electrical: ["storage", "electrical"],
  storage: ["storage"],
  admin: ["admin"],
  comms: ["storage", "comms"],
  weapons: ["weapons"],
  o2: ["weapons", "o2"],
  navigation: ["weapons", "navigation"],
  shields: ["storage", "comms", "shields"],
};

/** Walks someone from the cafeteria to a room, starting at `t`; returns when they get there. */
function walk(events: SusEvent[], p: string, t: number, to: RoomId): number {
  for (const step of PATHS[to]) events.push(move(p, (t += MOVE_MS), step));
  return t;
}

await check("moving: next door only, not too fast; ghosts anywhere; vents for impostors, and people see you use them", () => {
  const { events, imp, crew } = started(5);
  const [c1, c2, c3] = crew;
  events.push(move(c1, PLAY + 100, "electrical"));
  assert.equal(reduce(events, PLAY + 100)!.game!.agents.get(c1)!.room, "cafeteria", "electrical isn't next to the cafeteria");
  events.push(move(c1, PLAY + 200, "storage"), move(c2, PLAY + 200, "admin"), move(imp, PLAY + 200, "admin"));
  events.push(move(c1, PLAY + 300, "electrical"), move(c2, PLAY + 300, "cafeteria", true));
  let room = reduce(events, PLAY + 300)!;
  assert.equal(room.game!.agents.get(c1)!.room, "storage", "one step at a time");
  assert.equal(room.game!.agents.get(c2)!.room, "admin", "crew can't use vents");
  assert.deepEqual(privateView(room, c2)!.here, [imp]);
  events.push(move(c1, PLAY + 200 + MOVE_MS, "electrical"), move(imp, PLAY + 200 + MOVE_MS, "cafeteria", true));
  room = reduce(events, PLAY + 2000)!;
  assert.equal(room.game!.agents.get(c1)!.room, "electrical");
  assert.equal(room.game!.agents.get(imp)!.room, "cafeteria", "through the vent");
  assert.deepEqual(privateView(room, c2)!.seen, [{ t: PLAY + 200 + MOVE_MS, kind: "vent", who: imp, room: "admin" }]);
  assert.equal(privateView(room, c3)!.seen[0]?.room, "cafeteria", "and whoever's where they come out");
  assert.equal(privateView(room, c1)!.seen.length, 0, "but nobody else");
  assert.deepEqual(privateView(room, c2)!.table, { admin: 1, cafeteria: 3, electrical: 1 }, "admin shows how many are where");
  assert.equal(privateView(room, c1)!.table, null);
  // A ghost goes where it likes.
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS, p: imp, game: 1, target: c3 }, move(c3, PLAY + FIRST_KILL_MS + 100, "navigation"));
  room = reduce(events, PLAY + FIRST_KILL_MS + 100)!;
  assert.equal(room.game!.agents.get(c3)!.room, "navigation");
});

await check("tasks take their time, in the right place; the scan is watched, and impostors can't do it", () => {
  const { events, crew } = started(4);
  let room = reduce(events, PLAY)!;
  const worker = crew[0];
  const task = TASKS.find((x) => x.id === room.game!.agents.get(worker)!.tasks[0].id)!;
  const arrived = walk(events, worker, PLAY, task.room);
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
  game.events.push(move(scanner, PLAY + 100, "medbay"), move(watcher, PLAY + 100, "medbay"), move(game.imp, PLAY + 100, "medbay"));
  game.events.push({ k: "task", t: PLAY + 9000, p: scanner, game: 1, task: "scan" });
  room = reduce(game.events, PLAY + 9000)!;
  assert.equal(room.game!.agents.get(scanner)!.tasks.find((t) => t.id === "scan")!.done, false, "no scan without getting on the scanner");
  game.events.push({ k: "begin", t: PLAY + 9000, p: scanner, game: 1, task: "scan" }, { k: "begin", t: PLAY + 9000, p: game.imp, game: 1, task: "scan" });
  room = reduce(game.events, PLAY + 9000)!;
  assert.deepEqual(privateView(room, watcher)!.scanning, [scanner], "everyone there can see who's on the scanner, and it's never the impostor");
  game.events.push({ k: "task", t: PLAY + 9000 + 8000, p: scanner, game: 1, task: "scan" });
  room = reduce(game.events, PLAY + 17_000)!;
  assert.equal(room.game!.agents.get(scanner)!.tasks.find((t) => t.id === "scan")!.done, true);
});

await check("the whole crew's tasks done wins it", () => {
  const { events, crew } = started(4, { tasks: 3 });
  const room = reduce(events, PLAY)!;
  let t = PLAY;
  for (const id of crew) {
    for (const task of room.game!.agents.get(id)!.tasks.map((x) => TASKS.find((y) => y.id === x.id)!)) {
      t = walk(events, id, t, task.room);
      if (task.kind === "scan") events.push({ k: "begin", t: (t += 100), p: id, game: 1, task: task.id });
      events.push({ k: "task", t: (t += task.min + 100), p: id, game: 1, task: task.id });
      // And back to the cafeteria for the next.
      for (const step of [...PATHS[task.room]].reverse().slice(1)) events.push(move(id, (t += MOVE_MS), step));
      if (PATHS[task.room].length) events.push(move(id, (t += MOVE_MS), "cafeteria"));
    }
  }
  const end = reduce(events, t)!;
  assert.equal(phaseOf(end), "over");
  assert.deepEqual(end.game!.result, { winner: "crew", why: "tasks" });
  assert.deepEqual(viewOf(end, t).game!.tasks, { done: 9, total: 9 });
});


await check("kills: not straight away, only who's with you, seen by anyone else there, not in the dark", () => {
  const { events, imp, crew } = started(6);
  const [victim, witness, other] = crew;
  events.push({ k: "kill", t: PLAY + 5000, p: imp, game: 1, target: victim });
  let room = reduce(events, PLAY + 5000)!;
  assert.equal(room.game!.agents.get(victim)!.alive, true, "not before the first cooldown");
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS, p: imp, game: 1, target: victim });
  room = reduce(events, PLAY + FIRST_KILL_MS)!;
  assert.equal(room.game!.agents.get(victim)!.alive, false);
  assert.equal(privateView(room, victim)!.killer, imp, "you know who did it");
  assert.equal(privateView(room, witness)!.seen[0].kind, "kill", "everyone in the room saw");
  assert.deepEqual(privateView(room, witness)!.bodies, [victim]);
  assert.ok(!privateView(room, witness)!.here.includes(victim), "the dead aren't among the living");
  assert.equal(viewOf(room, PLAY + FIRST_KILL_MS).players.find((p) => p.id === victim)!.dead, false, "nobody's told yet");

  // The impostor follows `other` to admin, can't kill again yet, and turns the lights out.
  events.push(move(imp, PLAY + 11_000, "admin"), move(other, PLAY + 11_000, "admin"), move(witness, PLAY + 11_000, "medbay"));
  events.push({ k: "kill", t: PLAY + 12_000, p: imp, game: 1, target: other });
  room = reduce(events, PLAY + 12_000)!;
  assert.equal(room.game!.agents.get(other)!.alive, true, "the cooldown");
  events.push({ k: "sabotage", t: PLAY + 12_000, p: imp, game: 1, kind: "lights" });
  room = reduce(events, PLAY + 12_000)!;
  assert.equal(privateView(room, other)!.dark, true);
  assert.deepEqual(privateView(room, other)!.here, [], "you can't see who's with you in the dark");
  assert.deepEqual(privateView(room, imp)!.here, [other], "the impostor can");
  assert.equal(viewOf(room, PLAY + 12_000).game!.sabotage!.kind, "lights", "everyone hears the alarm");
  const second = PLAY + FIRST_KILL_MS + DEFAULT_SETTINGS.kill * 1000;
  events.push(join("z", second - 1), { k: "kill", t: second, p: imp, game: 1, target: other });
  room = reduce(events, second)!;
  assert.equal(room.game!.agents.get(other)!.alive, false);
  assert.equal(room.game!.agents.has("z"), false, "someone arriving midway waits for the next game");
});

await check("the impostors win once there are as many of them as crew", () => {
  const { events, imp, crew } = started(4);
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS, p: imp, game: 1, target: crew[0] });
  let room = reduce(events, PLAY + FIRST_KILL_MS)!;
  assert.equal(phaseOf(room), "action", "one impostor and two crew left");
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS + 30_000, p: imp, game: 1, target: crew[1] });
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
  events.push({ k: "kill", t: PLAY + FIRST_KILL_MS, p: imp, game: 1, target: victim }, { k: "report", t: start, p: finder, game: 1, body: victim });
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
  assert.equal(view.game!.ejection, null);
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
  let room = reduce(events, PLAY + BUTTON_MS)!;
  assert.equal(phaseOf(room), "meeting");
  assert.equal(room.game!.meeting!.body, null);
  const open = PLAY + BUTTON_MS + MEETINGS.short.discuss * 1000;
  const votes: [string, string][] = [[crew[0], imp], [crew[1], imp], [imp, crew[2]], [crew[2], crew[3]], [crew[3], crew[2]]];
  for (const [p, choice] of votes) events.push({ k: "vote", t: open, p, game: 1, meeting: 1, for: choice });
  room = reduce(events, open)!;
  assert.equal(phaseOf(room), "ejection", "everyone's voted");
  let view = viewOf(room, open);
  assert.deepEqual([view.game!.ejection!.ejected, view.game!.ejection!.tie], [null, true]);
  const back = open + EJECT_MS;
  room = reduce(events, back)!;
  assert.equal(phaseOf(room), "action");
  assert.ok([...room.game!.agents.values()].every((a) => a.room === "cafeteria"), "everyone back at the table");
  assert.equal(room.game!.agents.get(imp)!.killAt, back + DEFAULT_SETTINGS.kill * 1000, "the kill cooldown starts again");
  events.push(move(crew[1], back + 100, "admin"));
  events.push({ k: "button", t: back + BUTTON_MS, p: crew[0], game: 1 }, { k: "button", t: back + BUTTON_MS, p: crew[1], game: 1 });
  assert.equal(phaseOf(reduce(events, back + BUTTON_MS)!), "action", "one each, and from the cafeteria");
  events.push({ k: "button", t: back + BUTTON_MS, p: crew[2], game: 1 });
  assert.equal(phaseOf(reduce(events, back + BUTTON_MS)!), "meeting");
  const second = back + BUTTON_MS + MEETINGS.short.discuss * 1000;
  for (const p of [imp, ...crew]) events.push({ k: "vote", t: second, p, game: 1, meeting: 2, for: p === crew[0] ? crew[3] : "skip" });
  view = viewOf(reduce(events, second)!, second);
  assert.deepEqual([view.game!.ejection!.ejected, view.game!.ejection!.skipped], [null, true]);

  // With confirm off, voting someone off doesn't say what they were.
  const quiet = started(5, { meeting: "short", confirm: false });
  quiet.events.push({ k: "button", t: PLAY + BUTTON_MS, p: quiet.crew[0], game: 1 });
  for (const p of [quiet.imp, ...quiet.crew]) quiet.events.push({ k: "vote", t: PLAY + BUTTON_MS + 15_000, p, game: 1, meeting: 1, for: quiet.crew[3] });
  view = viewOf(reduce(quiet.events, PLAY + BUTTON_MS + 15_000)!, 0);
  assert.equal(view.game!.ejection!.ejected, quiet.crew[3]);
  assert.deepEqual([view.game!.ejection!.impostor, view.game!.ejection!.remaining], [null, null]);
  assert.equal(view.players.find((p) => p.id === quiet.crew[3])!.impostor, null);
});

await check("sabotage: the lights are fixed in electrical, the reactor by two hands at once, or it melts down", () => {
  const { events, imp, crew } = started(5);
  const at = PLAY + 10_000;
  events.push({ k: "sabotage", t: at, p: imp, game: 1, kind: "reactor" });
  assert.equal(viewOf(reduce(events, at)!, at).game!.sabotage!.ends, at + REACTOR_MS);
  const pressed: SusEvent[] = [...events, { k: "button", t: at + BUTTON_MS, p: crew[0], game: 1 }];
  assert.equal(phaseOf(reduce(pressed, at + BUTTON_MS)!), "action", "no button during a meltdown");
  for (const [i, step] of (["medbay", "upper", "reactor"] as RoomId[]).entries()) for (const p of crew.slice(0, 2)) events.push(move(p, at + 1000 + i * MOVE_MS, step));
  events.push({ k: "fix", t: at + 6000, p: crew[0], game: 1, kind: "reactor" });
  let room = reduce(events, at + 6000)!;
  assert.equal(viewOf(room, at + 6000).game!.sabotage!.hands, 1);
  events.push({ k: "fix", t: at + 7000, p: crew[1], game: 1, kind: "reactor" });
  room = reduce(events, at + 7000)!;
  assert.equal(room.game!.sabotage, null, "two hands");
  assert.equal(room.game!.sabotageAt, at + 7000 + SABOTAGE_MS);
  events.push({ k: "sabotage", t: at + 8000, p: imp, game: 1, kind: "lights" });
  assert.equal(reduce(events, at + 8000)!.game!.sabotage, null, "not again so soon");
  events.push({ k: "sabotage", t: at + 7000 + SABOTAGE_MS, p: imp, game: 1, kind: "lights" });
  events.push(move(crew[2], at + 7000 + SABOTAGE_MS, "storage"), move(crew[2], at + 7000 + SABOTAGE_MS + MOVE_MS, "electrical"));
  events.push({ k: "fix", t: at + 7000 + SABOTAGE_MS + MOVE_MS, p: crew[2], game: 1, kind: "lights" });
  assert.equal(reduce(events, at + 7000 + SABOTAGE_MS + MOVE_MS)!.game!.sabotage, null, "lights back on");

  const melt = started(5);
  melt.events.push({ k: "sabotage", t: at, p: melt.imp, game: 1, kind: "reactor" });
  assert.deepEqual(reduce(melt.events, at + REACTOR_MS)!.game!.result, { winner: "impostors", why: "reactor" });
});

await check("leaving: the crew's tasks go with them, and the impostor going ends it", () => {
  const { events, imp, crew } = started(5, { tasks: 3 });
  events.push({ k: "leave", t: PLAY + 1000, p: crew[0], why: "left" });
  let room = reduce(events, PLAY + 1000)!;
  assert.equal(viewOf(room, PLAY + 1000).game!.tasks.total, 9);
  assert.equal(viewOf(room, PLAY + 1000).players.find((p) => p.id === crew[0])!.dead, true);
  events.push({ k: "leave", t: PLAY + 2000, p: imp, why: "gone" });
  room = reduce(events, PLAY + 2000)!;
  assert.deepEqual(room.game!.result, { winner: "crew", why: "left" });
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
  await assert.rejects(as(1, { type: "start" }), fails(403));
  await as(0, { type: "settings", settings: { ...DEFAULT_SETTINGS, meeting: "short" } });
  await as(0, { type: "start" });
  let view = await getRoom(store, code, clock.now);
  assert.ok(!JSON.stringify({ ...view, seals: null }).includes('"impostor":true'));
  assert.equal(new Set(Object.values(view.seals).map((s) => s.box.length)).size, 1, "every sealed view is the same size");
  const mines = await Promise.all(seats.map((s) => open(s.key, view, s.who.id)));
  assert.ok(mines.every((m) => m !== null), "everyone can open their own");
  assert.equal(await open(seats[0].key, view, id(1)), null, "and nobody else's");
  assert.equal(mines.filter((m) => m!.impostor).length, 1);
  const imp = mines.findIndex((m) => m!.impostor);
  const crew = [0, 1, 2, 3, 4].filter((i) => i !== imp);

  clock.now += ROLES_MS;
  await assert.rejects(as(crew[0], { type: "move", game: 1, to: "electrical" }), fails(409));
  let reply = await as(crew[0], { type: "move", game: 1, to: "admin" });
  assert.equal(reply.mine!.room, "admin");
  await assert.rejects(as(crew[0], { type: "move", game: 1, to: "cafeteria" }), fails(409), "not so fast");
  await assert.rejects(as(crew[1], { type: "kill", game: 1, target: id(crew[2]) }), fails(409), "crew can't kill");
  await assert.rejects(as(imp, { type: "kill", game: 1, target: id(crew[1]) }), fails(409), "not yet");
  await assert.rejects(as(crew[1], { type: "say", text: "hi" }), fails(409), "no talking till a meeting");
  clock.now += FIRST_KILL_MS;
  reply = await as(imp, { type: "kill", game: 1, target: id(crew[1]) });
  assert.deepEqual(reply.mine!.bodies, [id(crew[1])]);
  view = await getRoom(store, code, clock.now);
  assert.equal((await open(seats[crew[1]].key, view, id(crew[1])))!.alive, false);
  assert.equal((await open(seats[crew[2]].key, view, id(crew[2])))!.seen[0].kind, "kill", "the others in the cafeteria saw");
  await assert.rejects(as(crew[0], { type: "report", game: 1, body: id(crew[1]) }), fails(409), "the body's not in admin");
  reply = await as(crew[2], { type: "report", game: 1, body: id(crew[1]) });
  assert.equal(reply.room.game!.phase, "meeting");
  await as(crew[2], { type: "say", text: "i saw it!" });
  await as(crew[1], { type: "say", text: "boo" });
  view = await getRoom(store, code, clock.now);
  assert.deepEqual(view.chat.filter((c) => !c.iv).map((c) => c.text), ["i saw it!"]);
  const ghostLine = view.chat.find((c) => c.iv)!;
  assert.ok(ghostLine.text !== "boo", "the dead's chat is sealed");
  const ghost = await open(seats[crew[1]].key, view, id(crew[1]));
  assert.equal(await unseal(ghost!.ghostKey!, ghostLine.iv!, ghostLine.text), "boo");
  assert.equal((await open(seats[crew[2]].key, view, id(crew[2])))!.ghostKey, null, "only the dead get the key");
  await assert.rejects(as(crew[0], { type: "vote", game: 1, meeting: 1, for: id(imp) }), fails(409), "voting isn't open yet");
  clock.now += MEETINGS.short.discuss * 1000;
  await assert.rejects(as(crew[1], { type: "vote", game: 1, meeting: 1, for: id(imp) }), fails(409), "the dead can't vote");
  for (const i of [crew[0], crew[2], crew[3]]) await as(i, { type: "vote", game: 1, meeting: 1, for: id(imp) });
  reply = await as(imp, { type: "vote", game: 1, meeting: 1, for: "skip" });
  assert.equal(reply.room.game!.phase, "ejection");
  assert.equal(reply.room.game!.ejection!.ejected, id(imp));
  clock.now += EJECT_MS;
  view = await getRoom(store, code, clock.now);
  assert.equal(view.game!.phase, "over");
  assert.equal(view.game!.result!.winner, "crew");
  await assert.rejects(getRoom(store, "ZZZZ", clock.now), fails(404));
  return code;
}

await check("the API plays a game through, sealed views and all, in memory", async () => {
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
  } finally {
    await upstash.close();
  }
});

assert.equal((await seatKey("salt", "a")).length, 44);
console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} sus checks passed`);
