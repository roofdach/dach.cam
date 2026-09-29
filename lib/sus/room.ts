/**
 * An among us for a room. Everyone's a crewmate but one or more impostors,
 * and only the impostors know who they are. Crewmates go round the ship
 * doing tasks; impostors pretend to, and kill whoever they catch alone. A
 * body found, or the button in the cafeteria, calls everyone to a meeting
 * to talk it over and vote someone off. The crew win by finishing every
 * task or voting off every impostor; the impostors win once there are as
 * many of them as crew, or if they melt the reactor down.
 *
 * You go from room to room (see lib/sus/ship.ts) and only see who's in
 * the room with you, so almost everything here is secret from someone. As
 * with the other rooms (see lib/draw/room.ts), the server keeps a log of
 * what happened and this replays it; `viewOf` is what everyone may know,
 * and `privateView` is what one player may, which the server seals so only
 * they can read it (see lib/sus/server/rooms.ts).
 */

import { cleanName } from "../rooms/codes.ts";
import { seededRandom, type Random } from "../random.ts";
import { CAMERAS, COLORS, ROOM_IDS, SPOTS, TASKS, TASK_BY_ID, exitsFrom, ventsFrom, type RoomId, type Task } from "./ship.ts";

export const IMPOSTOR_CHOICES = [1, 2, 3] as const;
/** Seconds between kills. */
export const KILL_CHOICES = [20, 30, 45] as const;
/** Tasks each. */
export const TASK_CHOICES = [3, 5, 7] as const;
/** Seconds to talk before the vote opens, and to vote. */
export const MEETINGS = { short: { discuss: 15, vote: 30 }, normal: { discuss: 30, vote: 60 }, long: { discuss: 45, vote: 90 } } as const;
export type MeetingLength = keyof typeof MEETINGS;
export const MEETING_NAMES: readonly MeetingLength[] = ["short", "normal", "long"];

export interface Settings {
  impostors: number;
  kill: number;
  tasks: number;
  meeting: MeetingLength;
  /** Whether an ejection says if they were an impostor. */
  confirm: boolean;
}

export const DEFAULT_SETTINGS: Settings = { impostors: 1, kill: 30, tasks: 5, meeting: "normal", confirm: true };

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = COLORS.length;
/** Seeing who you are. */
export const ROLES_MS = 6000;
/** Between one step and the next: the ship takes a moment to cross. */
export const MOVE_MS = 1500;
/** Before the first kill and sabotage of the game, and the first after a meeting. */
export const FIRST_KILL_MS = 10_000;
export const FIRST_SABOTAGE_MS = 10_000;
/** Between one sabotage being fixed and the next. */
export const SABOTAGE_MS = 30_000;
/** To stop the reactor melting down: two people on its scanners at once. */
export const REACTOR_MS = 45_000;
export const REACTOR_HANDS = 2;
/** Before the emergency button works, after each meeting and at the start. */
export const BUTTON_MS = 15_000;
export const BUTTONS_EACH = 1;
export const EJECT_MS = 7000;
export const AWAY_MS = 30_000;
export const GONE_MS = 60_000;
export const MAX_EVENTS = 10_000;

/** How many impostors a game of this size gets: one up to six players, two for seven or eight, three for nine or more. */
export const impostorsFor = (players: number, wanted: number) => Math.max(1, Math.min(wanted, players >= 9 ? 3 : players >= 7 ? 2 : 1));

export type Sabotage = "lights" | "reactor";

export type SusEvent =
  | { k: "create"; t: number; code: string; salt: string; settings: Settings }
  | { k: "join"; t: number; p: string; name: string; tok: string }
  | { k: "leave"; t: number; p: string; why: "left" | "gone" | "kicked"; by?: string }
  | { k: "settings"; t: number; p: string; settings: Settings }
  | { k: "start"; t: number; p: string }
  | { k: "move"; t: number; p: string; game: number; to: RoomId; vent?: boolean }
  | { k: "begin"; t: number; p: string; game: number; task: string }
  | { k: "task"; t: number; p: string; game: number; task: string }
  | { k: "kill"; t: number; p: string; game: number; target: string }
  | { k: "report"; t: number; p: string; game: number; body: string }
  | { k: "button"; t: number; p: string; game: number }
  | { k: "sabotage"; t: number; p: string; game: number; kind: Sabotage }
  | { k: "fix"; t: number; p: string; game: number; kind: Sabotage }
  | { k: "vote"; t: number; p: string; game: number; meeting: number; for: string }
  | { k: "lobby"; t: number; p: string };

export interface Player {
  id: string;
  name: string;
  tok: string;
  seq: number;
  /** Which of COLORS they are. */
  color: number;
  active: boolean;
  kicked: boolean;
  since: number;
}

/** Something you saw happen: nobody else knows you did. */
export type Note =
  | { t: number; kind: "kill"; who: string; whom: string; room: RoomId }
  | { t: number; kind: "vent"; who: string; room: RoomId };

/** Someone playing this game. */
export interface Agent {
  id: string;
  impostor: boolean;
  alive: boolean;
  /** Whether everyone knows they're dead: since the meeting after, or because they were voted off or left. */
  known: boolean;
  ejected: boolean;
  left: boolean;
  killer: string | null;
  room: RoomId;
  /** When they got to the room they're in. */
  arrived: number;
  moveAt: number;
  /** Real ones for crew; for impostors, ones to pretend to do. */
  tasks: { id: string; done: boolean }[];
  /** When they got on the medbay scanner, while they're on it. */
  scanning: number | null;
  /** On the reactor's scanner, during a meltdown. */
  holding: boolean;
  killAt: number;
  buttons: number;
  vote: string | null;
  seen: Note[];
}

export interface Body {
  victim: string;
  room: RoomId;
  at: number;
}

export interface Meeting {
  index: number;
  caller: string;
  /** Whose body was found, and where; null for the button. */
  body: string | null;
  where: RoomId | null;
  votesFrom: number;
  ends: number;
}

export interface Ejection {
  ejected: string | null;
  tie: boolean;
  skipped: boolean;
  /** Who voted for whom ("skip" for a skip). */
  votes: Record<string, string>;
}

export type Winner = "crew" | "impostors";
/** How it was won: crew by tasks, votes, or the impostors leaving; impostors by outnumbering the crew, the reactor, or the crew leaving. */
export type Why = "tasks" | "votes" | "outnumbered" | "reactor" | "left";

export type Phase = "lobby" | "roles" | "action" | "meeting" | "ejection" | "over";
export type GamePhase = Exclude<Phase, "lobby">;

export interface Game {
  index: number;
  settings: Settings;
  impostors: number;
  phase: GamePhase;
  /** When the phase that's on ends: not used while playing, where only the reactor has a clock. */
  ends: number;
  agents: Map<string, Agent>;
  bodies: Body[];
  sabotage: { kind: Sabotage; ends: number | null } | null;
  sabotageAt: number;
  buttonAt: number;
  meeting: Meeting | null;
  meetings: number;
  ejection: Ejection | null;
  result: { winner: Winner; why: Why } | null;
}

export interface Room {
  code: string;
  salt: string;
  settings: Settings;
  players: Map<string, Player>;
  host: string | null;
  game: Game | null;
  games: number;
  clock: number;
  version: number;
}

const NEVER = Number.MAX_SAFE_INTEGER;

/* ----------------------------------------------------------- checking */

const oneOf = <T>(choices: readonly T[], value: unknown): value is T => (choices as readonly unknown[]).includes(value);

export function cleanSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const { impostors, kill, tasks, meeting, confirm } = value as Record<string, unknown>;
  if (!oneOf(IMPOSTOR_CHOICES, impostors) || !oneOf(KILL_CHOICES, kill) || !oneOf(TASK_CHOICES, tasks) || !oneOf(MEETING_NAMES, meeting) || typeof confirm !== "boolean") return null;
  return { impostors, kill, tasks, meeting, confirm };
}

export const isRoom = (value: unknown): value is RoomId => oneOf(ROOM_IDS, value);

/* ------------------------------------------------------------ replay */

const activePlayers = (room: Room) => [...room.players.values()].filter((p) => p.active).sort((a, b) => a.seq - b.seq);

function electHost(room: Room) {
  room.host = activePlayers(room)[0]?.id ?? null;
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A colour nobody here, or in the game that's on, is wearing; their old one if it's free. */
function pickColor(room: Room, player: string, wanted: number | null): number {
  const worn = new Set<number>();
  for (const other of room.players.values()) {
    if (other.id !== player && (other.active || room.game?.agents.has(other.id))) worn.add(other.color);
  }
  if (wanted !== null && !worn.has(wanted)) return wanted;
  for (let i = 0; i < COLORS.length; i++) if (!worn.has(i)) return i;
  return 0;
}

/** Someone's tasks, fixed by the salt: as many different kinds of job as there's room for. */
export function tasksFor(salt: string, game: number, player: string, count: number): Task[] {
  const shuffled = shuffle(TASKS, seededRandom(`${salt}:tasks:${game}:${player}`));
  const picked: Task[] = [];
  for (const task of shuffled) if (picked.length < count && !picked.some((p) => p.kind === task.kind)) picked.push(task);
  for (const task of shuffled) if (picked.length < count && !picked.includes(task)) picked.push(task);
  return picked;
}

const agentsOf = (game: Game) => [...game.agents.values()];

/** Whether the lights are out for this agent: the living crew can't see anyone in the dark. */
const inTheDark = (game: Game, agent: Agent) => game.sabotage?.kind === "lights" && agent.alive && !agent.impostor;

function finish(game: Game, at: number, winner: Winner, why: Why) {
  game.result = { winner, why };
  // An ejection still gets shown before the end.
  if (game.phase !== "ejection") {
    game.phase = "over";
    game.ends = at;
  }
}

/** Whether anyone's won, after something that could have done it. */
function checkWin(game: Game, at: number, cause: Why) {
  if (game.result) return;
  const agents = agentsOf(game);
  const impostors = agents.filter((a) => a.impostor && a.alive).length;
  const crew = agents.filter((a) => !a.impostor && a.alive).length;
  if (impostors === 0) return finish(game, at, "crew", cause === "left" ? "left" : "votes");
  if (impostors >= crew) return finish(game, at, "impostors", cause === "left" && crew === 0 ? "left" : "outnumbered");
  const workers = agents.filter((a) => !a.impostor && !a.left);
  if (workers.length > 0 && workers.every((a) => a.tasks.every((t) => t.done))) finish(game, at, "crew", "tasks");
}

/** Everyone back to the cafeteria, and off: at the start, and after every meeting. */
function play(game: Game, at: number, first: boolean) {
  game.phase = "action";
  game.ends = at;
  game.meeting = null;
  game.ejection = null;
  game.bodies = [];
  game.sabotage = null;
  game.sabotageAt = at + FIRST_SABOTAGE_MS;
  game.buttonAt = at + BUTTON_MS;
  for (const agent of game.agents.values()) {
    agent.room = "cafeteria";
    agent.arrived = at;
    agent.moveAt = at;
    agent.scanning = null;
    agent.holding = false;
    agent.vote = null;
    agent.seen = [];
    agent.killAt = at + (first ? FIRST_KILL_MS : game.settings.kill * 1000);
  }
}

function sabotageFixed(game: Game, at: number) {
  game.sabotage = null;
  game.sabotageAt = at + SABOTAGE_MS;
  for (const agent of game.agents.values()) agent.holding = false;
}

function callMeeting(game: Game, at: number, caller: string, body: Body | null) {
  game.meetings++;
  for (const agent of game.agents.values()) {
    // Everyone who's died so far is shown dead at the table.
    if (!agent.alive) agent.known = true;
    agent.scanning = null;
    agent.holding = false;
    agent.vote = null;
  }
  game.bodies = [];
  game.sabotage = null;
  const { discuss, vote } = MEETINGS[game.settings.meeting];
  game.meeting = { index: game.meetings, caller, body: body?.victim ?? null, where: body?.room ?? null, votesFrom: at + discuss * 1000, ends: at + (discuss + vote) * 1000 };
  game.phase = "meeting";
  game.ends = game.meeting.ends;
}

/** Counts the votes: the most wins, unless it's a tie or skipping wins. */
function tally(game: Game, at: number) {
  const votes: Record<string, string> = {};
  const counts = new Map<string, number>();
  for (const agent of game.agents.values()) {
    if (!agent.alive || agent.vote === null) continue;
    votes[agent.id] = agent.vote;
    counts.set(agent.vote, (counts.get(agent.vote) ?? 0) + 1);
  }
  let best: string | null = null;
  let top = 0;
  let tie = false;
  for (const [choice, n] of counts) {
    if (n > top) [best, top, tie] = [choice, n, false];
    else if (n === top) tie = true;
  }
  const ejected = !tie && best !== null && best !== "skip" ? best : null;
  if (ejected) {
    const agent = game.agents.get(ejected)!;
    agent.alive = false;
    agent.ejected = true;
    agent.known = true;
  }
  game.ejection = { ejected, tie, skipped: !ejected && !tie, votes };
  game.phase = "ejection";
  game.ends = at + EJECT_MS;
  checkWin(game, at, "votes");
}

/** Brings the room's timeline up to `t`: roles give way to play, meetings end, the reactor melts down. */
function advance(room: Room, t: number) {
  if (t > room.clock) room.clock = t;
  const now = room.clock;
  for (;;) {
    const game = room.game;
    if (!game || game.phase === "over") return;
    if (game.phase === "action") {
      const reactor = game.sabotage?.kind === "reactor" ? game.sabotage.ends : null;
      if (reactor === null || now < reactor) return;
      finish(game, reactor, "impostors", "reactor");
    } else if (now < game.ends) {
      return;
    } else if (game.phase === "roles") {
      play(game, game.ends, true);
    } else if (game.phase === "meeting") {
      tally(game, game.ends);
    } else if (game.result) {
      game.phase = "over";
    } else {
      play(game, game.ends, false);
    }
  }
}

/** Everyone in the room with `agent` who'd see what they did: the living, if they can see. */
function witnesses(game: Game, agent: Agent, room: RoomId, except: string[] = []) {
  return agentsOf(game).filter((w) => w.alive && w.room === room && w.id !== agent.id && !except.includes(w.id) && !inTheDark(game, w));
}

function apply(room: Room, event: SusEvent) {
  advance(room, event.t);
  const t = room.clock;
  const player = "p" in event ? room.players.get(event.p) : undefined;
  const isHost = player !== undefined && player.id === room.host;
  const game = room.game;
  const going = game !== null && game.phase !== "over";
  // Whoever did it, if they're playing this game, it's on, and it's about this one.
  const agent = going && player?.active && "game" in event && event.game === game.index ? game.agents.get(player.id) : undefined;
  const acting = agent && !agent.left && game?.phase === "action" ? agent : undefined;

  switch (event.k) {
    case "create":
      return;

    case "join": {
      const name = cleanName(event.name);
      if (!name) return;
      const active = activePlayers(room).length;
      if (player) {
        if (player.kicked || player.tok !== event.tok) return;
        if (!player.active && active >= MAX_PLAYERS) return;
        player.active = true;
        player.name = name;
        player.since = t;
        player.color = pickColor(room, player.id, player.color);
      } else {
        if (active >= MAX_PLAYERS) return;
        room.players.set(event.p, { id: event.p, name, tok: event.tok, seq: room.players.size, color: pickColor(room, event.p, null), active: true, kicked: false, since: t });
      }
      electHost(room);
      return;
    }

    case "leave": {
      if (!player?.active) return;
      if (event.why === "kicked" && (event.by !== room.host || event.by === player.id)) return;
      player.active = false;
      if (event.why === "kicked") player.kicked = true;
      electHost(room);
      const gone = going ? game.agents.get(player.id) : undefined;
      if (!going || !gone || gone.left) return;
      gone.left = true;
      gone.alive = false;
      gone.known = true;
      gone.scanning = null;
      gone.holding = false;
      checkWin(game, t, "left");
      if (game.phase === "meeting" && agentsOf(game).every((a) => !a.alive || a.vote !== null)) tally(game, t);
      return;
    }

    case "settings": {
      const settings = cleanSettings(event.settings);
      if (!isHost || going || !settings) return;
      room.settings = settings;
      return;
    }

    case "start": {
      const players = activePlayers(room);
      if (!isHost || going || players.length < MIN_PLAYERS) return;
      room.games++;
      const settings = { ...room.settings };
      const count = impostorsFor(players.length, settings.impostors);
      const impostors = new Set(shuffle(players.map((p) => p.id), seededRandom(`${room.salt}:roles:${room.games}`)).slice(0, count));
      const agents = new Map<string, Agent>();
      for (const p of players) {
        agents.set(p.id, {
          id: p.id,
          impostor: impostors.has(p.id),
          alive: true,
          known: false,
          ejected: false,
          left: false,
          killer: null,
          room: "cafeteria",
          arrived: t,
          moveAt: t,
          tasks: tasksFor(room.salt, room.games, p.id, settings.tasks).map((task) => ({ id: task.id, done: false })),
          scanning: null,
          holding: false,
          killAt: NEVER,
          buttons: BUTTONS_EACH,
          vote: null,
          seen: [],
        });
      }
      room.game = {
        index: room.games,
        settings,
        impostors: count,
        phase: "roles",
        ends: t + ROLES_MS,
        agents,
        bodies: [],
        sabotage: null,
        sabotageAt: NEVER,
        buttonAt: NEVER,
        meeting: null,
        meetings: 0,
        ejection: null,
        result: null,
      };
      return;
    }

    case "move": {
      if (!acting || t < acting.moveAt || !isRoom(event.to) || event.to === acting.room) return;
      if (event.vent) {
        if (!acting.impostor || !acting.alive || !ventsFrom(acting.room).includes(event.to)) return;
        // Anyone who can see sees you go in, and come out.
        for (const w of witnesses(game!, acting, acting.room)) w.seen.push({ t, kind: "vent", who: acting.id, room: acting.room });
        for (const w of witnesses(game!, acting, event.to)) w.seen.push({ t, kind: "vent", who: acting.id, room: event.to });
      } else if (acting.alive && !exitsFrom(acting.room).includes(event.to)) {
        // Ghosts go anywhere.
        return;
      }
      acting.room = event.to;
      acting.arrived = t;
      acting.moveAt = t + MOVE_MS;
      acting.scanning = null;
      acting.holding = false;
      return;
    }

    case "begin": {
      const task = TASK_BY_ID.get(event.task);
      if (!acting || acting.impostor || task?.kind !== "scan" || acting.room !== task.room) return;
      if (acting.tasks.some((x) => x.id === task.id && !x.done)) acting.scanning = t;
      return;
    }

    case "task": {
      const task = TASK_BY_ID.get(event.task);
      const mine = acting?.tasks.find((x) => x.id === event.task);
      if (!acting || acting.impostor || !task || !mine || mine.done || acting.room !== task.room) return;
      const since = task.kind === "scan" ? acting.scanning : acting.arrived;
      if (since === null || t - since < task.min) return;
      mine.done = true;
      if (task.kind === "scan") acting.scanning = null;
      checkWin(game!, t, "tasks");
      return;
    }

    case "kill": {
      const victim = game?.agents.get(event.target);
      if (!acting?.impostor || !acting.alive || t < acting.killAt || !victim?.alive || victim.impostor || victim.room !== acting.room) return;
      const seeing = witnesses(game!, acting, acting.room, [victim.id]);
      victim.alive = false;
      victim.killer = acting.id;
      victim.scanning = null;
      victim.holding = false;
      game!.bodies.push({ victim: victim.id, room: victim.room, at: t });
      acting.killAt = t + game!.settings.kill * 1000;
      for (const w of seeing) w.seen.push({ t, kind: "kill", who: acting.id, whom: victim.id, room: victim.room });
      checkWin(game!, t, "outnumbered");
      return;
    }

    case "report": {
      const body = game?.bodies.find((b) => b.victim === event.body);
      if (!acting?.alive || !body || body.room !== acting.room) return;
      callMeeting(game!, t, acting.id, body);
      return;
    }

    case "button": {
      if (!acting?.alive || acting.room !== SPOTS.button || acting.buttons <= 0 || t < game!.buttonAt || game!.sabotage?.kind === "reactor") return;
      acting.buttons--;
      callMeeting(game!, t, acting.id, null);
      return;
    }

    case "sabotage": {
      // Impostors can still sabotage once they're dead.
      if (!acting?.impostor || game!.sabotage || t < game!.sabotageAt || (event.kind !== "lights" && event.kind !== "reactor")) return;
      game!.sabotage = { kind: event.kind, ends: event.kind === "reactor" ? t + REACTOR_MS : null };
      game!.sabotageAt = NEVER;
      return;
    }

    case "fix": {
      const sabotage = game?.sabotage;
      if (!acting?.alive || !sabotage || sabotage.kind !== event.kind) return;
      if (sabotage.kind === "lights" && acting.room === SPOTS.lights) sabotageFixed(game!, t);
      if (sabotage.kind === "reactor" && acting.room === SPOTS.reactor) {
        acting.holding = true;
        const hands = agentsOf(game!).filter((a) => a.alive && a.holding && a.room === SPOTS.reactor).length;
        if (hands >= REACTOR_HANDS) sabotageFixed(game!, t);
      }
      return;
    }

    case "vote": {
      const meeting = game?.meeting;
      if (!agent?.alive || game?.phase !== "meeting" || !meeting || meeting.index !== event.meeting || t < meeting.votesFrom || agent.vote !== null) return;
      if (event.for !== "skip" && !game.agents.get(event.for)?.alive) return;
      agent.vote = event.for;
      if (agentsOf(game).every((a) => !a.alive || a.vote !== null)) tally(game, t);
      return;
    }

    case "lobby": {
      if (!isHost || !game) return;
      room.game = null;
      return;
    }
  }
}

/** Replays a room's log up to `now`. Null if the log isn't a room. */
export function reduce(events: readonly SusEvent[], now: number): Room | null {
  const first = events[0];
  if (!first || first.k !== "create") return null;
  const room: Room = {
    code: first.code,
    salt: first.salt,
    settings: cleanSettings(first.settings) ?? { ...DEFAULT_SETTINGS },
    players: new Map(),
    host: null,
    game: null,
    games: 0,
    clock: first.t,
    version: 0,
  };
  for (const event of events.slice(1)) apply(room, event);
  advance(room, now);
  room.version = events.length;
  return room;
}

export const phaseOf = (room: Room): Phase => room.game?.phase ?? "lobby";

export function gonePlayers(room: Room, seen: Readonly<Record<string, number>>, now: number): string[] {
  return [...room.players.values()]
    .filter((p) => p.active && now - Math.max(seen[p.id] ?? 0, p.since) > GONE_MS)
    .map((p) => p.id);
}

/* -------------------------------------------------------------- view */

export interface PlayerView {
  id: string;
  name: string;
  /** Which of COLORS. */
  color: number;
  active: boolean;
  away: boolean;
  /** In the game that's on, rather than waiting for the next. */
  playing: boolean;
  /** Dead, as far as everyone knows: at the end, everyone knows. */
  dead: boolean;
  ejected: boolean;
  /** Only known at the end, or once they're voted off, if the host says so. */
  impostor: boolean | null;
}

export interface GameView {
  index: number;
  phase: GamePhase;
  ends: number;
  impostors: number;
  /** Everyone's tasks together, the bar all the crew are filling. */
  tasks: { done: number; total: number };
  /** Alarms everyone can hear. */
  sabotage: { kind: Sabotage; ends: number | null; hands: number } | null;
  buttonAt: number;
  meeting: (Meeting & { voted: string[] }) | null;
  ejection: (Ejection & { impostor: boolean | null; remaining: number | null }) | null;
  result: { winner: Winner; why: Why; impostors: string[] } | null;
}

export interface RoomView {
  code: string;
  version: number;
  now: number;
  host: string | null;
  settings: Settings;
  players: PlayerView[];
  game: GameView | null;
}

/**
 * What everyone in the room may see: the same for every player, so it can
 * be cached. Never who's an impostor, where anyone is, or who's died since
 * the last meeting.
 */
export function viewOf(room: Room, now: number, seen: Readonly<Record<string, number>> = {}): RoomView {
  const game = room.game;
  const over = game?.phase === "over";
  const players: PlayerView[] = [];
  for (const player of [...room.players.values()].sort((a, b) => a.seq - b.seq)) {
    const agent = game?.agents.get(player.id);
    if (!player.active && !agent) continue;
    const told = agent && (over || (agent.ejected && game!.settings.confirm));
    players.push({
      id: player.id,
      name: player.name,
      color: player.color,
      active: player.active,
      away: player.active && now - Math.max(seen[player.id] ?? 0, player.since) > AWAY_MS,
      playing: !!agent,
      dead: !!agent && !agent.alive && (agent.known || over),
      ejected: !!agent?.ejected,
      impostor: told ? agent.impostor : null,
    });
  }

  let gameView: GameView | null = null;
  if (game) {
    const agents = agentsOf(game);
    const work = agents.filter((a) => !a.impostor && !a.left).flatMap((a) => a.tasks);
    const ejection = game.phase === "ejection" || over ? game.ejection : null;
    const out = ejection?.ejected ? game.agents.get(ejection.ejected)! : null;
    gameView = {
      index: game.index,
      phase: game.phase,
      ends: game.ends,
      impostors: game.impostors,
      tasks: { done: work.filter((t) => t.done).length, total: work.length },
      sabotage:
        game.phase === "action" && game.sabotage
          ? { ...game.sabotage, hands: agents.filter((a) => a.alive && a.holding && a.room === SPOTS.reactor).length }
          : null,
      buttonAt: game.buttonAt,
      meeting: game.meeting && (game.phase === "meeting" || game.phase === "ejection") ? { ...game.meeting, voted: agents.filter((a) => a.vote !== null).map((a) => a.id) } : null,
      ejection: ejection
        ? {
            ...ejection,
            impostor: out && game.settings.confirm ? out.impostor : null,
            remaining: game.settings.confirm ? agents.filter((a) => a.impostor && a.alive).length : null,
          }
        : null,
      result: over && game.result ? { ...game.result, impostors: agents.filter((a) => a.impostor).map((a) => a.id) } : null,
    };
  }

  return { code: room.code, version: room.version, now, host: room.host, settings: room.settings, players, game: gameView };
}

/** What one player may know: who they are, where they are and what they can see from there. */
export interface Me {
  game: number;
  impostor: boolean;
  /** The other impostors, for an impostor. */
  mates: string[];
  alive: boolean;
  killer: string | null;
  room: RoomId;
  moveAt: number;
  /** Who you can see in here. */
  here: string[];
  /** Other ghosts in here, if you're one. */
  ghosts: string[];
  bodies: string[];
  /** Who's on the medbay scanner in front of you: only crew can be. */
  scanning: string[];
  dark: boolean;
  tasks: { id: string; done: boolean }[];
  /** For impostors: when you can next kill, and sabotage. */
  killAt: number | null;
  sabotageAt: number | null;
  buttons: number;
  holding: boolean;
  vote: string | null;
  seen: Note[];
  /** In admin: how many are in each room, bodies and all. */
  table: Partial<Record<RoomId, number>> | null;
  /** In security: who the cameras can see. */
  cameras: { room: RoomId; players: string[]; bodies: string[] }[] | null;
}

export function privateView(room: Room, player: string): Me | null {
  const game = room.game;
  const me = game?.agents.get(player);
  if (!game || !me) return null;
  const agents = agentsOf(game).filter((a) => !a.left);
  const others = agents.filter((a) => a.room === me.room && a.id !== me.id);
  const dark = inTheDark(game, me);
  const playing = game.phase === "action";
  const living = (where: RoomId) => agents.filter((a) => a.alive && a.room === where).map((a) => a.id);
  const bodiesIn = (where: RoomId) => game.bodies.filter((b) => b.room === where).map((b) => b.victim);
  let table: Me["table"] = null;
  if (playing && me.room === SPOTS.table) {
    table = {};
    for (const id of ROOM_IDS) {
      const count = living(id).length + bodiesIn(id).length;
      if (count > 0) table[id] = count;
    }
  }
  return {
    game: game.index,
    impostor: me.impostor,
    mates: me.impostor ? agentsOf(game).filter((a) => a.impostor && a.id !== me.id).map((a) => a.id) : [],
    alive: me.alive,
    killer: me.killer,
    room: me.room,
    moveAt: me.moveAt,
    here: playing && !dark ? others.filter((a) => a.alive).map((a) => a.id) : [],
    ghosts: playing && !me.alive ? others.filter((a) => !a.alive).map((a) => a.id) : [],
    bodies: playing ? bodiesIn(me.room) : [],
    scanning: playing && !dark ? others.filter((a) => a.alive && a.scanning !== null).map((a) => a.id) : [],
    dark,
    tasks: me.tasks,
    killAt: me.impostor ? me.killAt : null,
    sabotageAt: me.impostor ? game.sabotageAt : null,
    buttons: me.buttons,
    holding: me.holding,
    vote: me.vote,
    seen: me.seen,
    table,
    cameras: playing && me.room === SPOTS.cameras ? CAMERAS.map((id) => ({ room: id, players: living(id), bodies: bodiesIn(id) })) : null,
  };
}
