/**
 * The ship: fourteen rooms, the corridors between them, the vents only
 * impostors can use, the rooms the cameras in security can see, and the
 * tasks, each in a room of its own. You go from room to room rather than
 * walk about, since every step is a request (see lib/sus/room.ts), and a
 * step to the next room is the most anyone needs to keep up with.
 *
 * Positions are for drawing, on a board 1000 by 600, laid out the way
 * people who've played the game will expect.
 */

export const ROOM_IDS = [
  "cafeteria",
  "weapons",
  "o2",
  "navigation",
  "shields",
  "comms",
  "storage",
  "admin",
  "electrical",
  "lower",
  "security",
  "reactor",
  "upper",
  "medbay",
] as const;

export type RoomId = (typeof ROOM_IDS)[number];

export interface ShipRoom {
  id: RoomId;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ROOMS: Record<RoomId, ShipRoom> = {
  upper: { id: "upper", name: "upper engine", x: 90, y: 40, w: 150, h: 100 },
  reactor: { id: "reactor", name: "reactor", x: 10, y: 220, w: 110, h: 150 },
  security: { id: "security", name: "security", x: 170, y: 245, w: 110, h: 90 },
  lower: { id: "lower", name: "lower engine", x: 90, y: 460, w: 150, h: 100 },
  medbay: { id: "medbay", name: "medbay", x: 300, y: 150, w: 120, h: 100 },
  electrical: { id: "electrical", name: "electrical", x: 300, y: 380, w: 130, h: 110 },
  cafeteria: { id: "cafeteria", name: "cafeteria", x: 440, y: 20, w: 200, h: 160 },
  storage: { id: "storage", name: "storage", x: 470, y: 360, w: 140, h: 170 },
  admin: { id: "admin", name: "admin", x: 650, y: 250, w: 130, h: 90 },
  comms: { id: "comms", name: "comms", x: 650, y: 470, w: 110, h: 80 },
  weapons: { id: "weapons", name: "weapons", x: 720, y: 30, w: 130, h: 100 },
  o2: { id: "o2", name: "o2", x: 700, y: 160, w: 100, h: 70 },
  navigation: { id: "navigation", name: "navigation", x: 870, y: 200, w: 120, h: 120 },
  shields: { id: "shields", name: "shields", x: 800, y: 400, w: 120, h: 100 },
};

export const center = (id: RoomId) => ({ x: ROOMS[id].x + ROOMS[id].w / 2, y: ROOMS[id].y + ROOMS[id].h / 2 });

/** Corridors, both ways. */
export const CORRIDORS: readonly [RoomId, RoomId][] = [
  ["cafeteria", "medbay"],
  ["cafeteria", "weapons"],
  ["cafeteria", "admin"],
  ["cafeteria", "storage"],
  ["medbay", "upper"],
  ["upper", "reactor"],
  ["upper", "security"],
  ["reactor", "security"],
  ["reactor", "lower"],
  ["security", "lower"],
  ["lower", "electrical"],
  ["electrical", "storage"],
  ["storage", "admin"],
  ["storage", "comms"],
  ["comms", "shields"],
  ["shields", "navigation"],
  ["shields", "o2"],
  ["o2", "navigation"],
  ["o2", "weapons"],
  ["weapons", "navigation"],
];

/** Vents, both ways: impostors only, and anyone in the room sees you go in or come out. */
export const VENTS: readonly [RoomId, RoomId][] = [
  ["reactor", "upper"],
  ["reactor", "lower"],
  ["medbay", "security"],
  ["security", "electrical"],
  ["medbay", "electrical"],
  ["cafeteria", "admin"],
  ["weapons", "navigation"],
  ["navigation", "shields"],
];

const linked = (pairs: readonly [RoomId, RoomId][], room: RoomId): RoomId[] =>
  pairs.flatMap(([a, b]) => (a === room ? [b] : b === room ? [a] : []));

export const exitsFrom = (room: RoomId) => linked(CORRIDORS, room);
export const ventsFrom = (room: RoomId) => linked(VENTS, room);

/** What the cameras in security can see. */
export const CAMERAS: readonly RoomId[] = ["upper", "admin", "storage", "navigation"];

/** Where things are done that aren't tasks. */
export const SPOTS = { button: "cafeteria", table: "admin", cameras: "security", lights: "electrical", reactor: "reactor" } as const satisfies Record<string, RoomId>;

/** The kinds of little job a task is; each is a small game of its own in the browser. */
export type TaskKind = "wires" | "swipe" | "download" | "hold" | "simon" | "numbers" | "scan" | "asteroids" | "shields" | "course" | "steer" | "filter" | "align";

export interface Task {
  id: string;
  name: string;
  room: RoomId;
  kind: TaskKind;
  /** The least time it can take, from getting to the room (or starting the scan): quicker than this isn't doing it. */
  min: number;
}

export const TASKS: readonly Task[] = [
  { id: "wires-electrical", name: "fix wiring", room: "electrical", kind: "wires", min: 2000 },
  { id: "wires-security", name: "fix wiring", room: "security", kind: "wires", min: 2000 },
  { id: "card", name: "swipe card", room: "admin", kind: "swipe", min: 1000 },
  { id: "upload", name: "upload data", room: "admin", kind: "download", min: 6000 },
  { id: "download", name: "download data", room: "comms", kind: "download", min: 6000 },
  { id: "garbage", name: "empty garbage", room: "cafeteria", kind: "hold", min: 3000 },
  { id: "chute", name: "empty chute", room: "o2", kind: "hold", min: 3000 },
  { id: "fuel", name: "fuel engines", room: "storage", kind: "hold", min: 3000 },
  { id: "reactor", name: "start reactor", room: "reactor", kind: "simon", min: 3000 },
  { id: "manifolds", name: "unlock manifolds", room: "reactor", kind: "numbers", min: 2000 },
  // The one everyone can watch you do: impostors can't.
  { id: "scan", name: "submit scan", room: "medbay", kind: "scan", min: 8000 },
  { id: "asteroids", name: "clear asteroids", room: "weapons", kind: "asteroids", min: 4000 },
  { id: "shields", name: "prime shields", room: "shields", kind: "shields", min: 1500 },
  { id: "course", name: "chart course", room: "navigation", kind: "course", min: 1500 },
  { id: "steering", name: "stabilize steering", room: "navigation", kind: "steer", min: 500 },
  { id: "filter", name: "clean o2 filter", room: "o2", kind: "filter", min: 1500 },
  { id: "align-upper", name: "align engine output", room: "upper", kind: "align", min: 1000 },
  { id: "align-lower", name: "align engine output", room: "lower", kind: "align", min: 1000 },
];

export const TASK_BY_ID: ReadonlyMap<string, Task> = new Map(TASKS.map((t) => [t.id, t]));

/** Everyone's colour, the way people will talk about each other: "red's sus". */
export const COLORS = [
  { name: "red", hex: "#c51111" },
  { name: "blue", hex: "#132ed1" },
  { name: "green", hex: "#117f2d" },
  { name: "pink", hex: "#ed54ba" },
  { name: "orange", hex: "#ef7d0d" },
  { name: "yellow", hex: "#f5f557" },
  { name: "black", hex: "#3f474e" },
  { name: "white", hex: "#d6e0f0" },
  { name: "purple", hex: "#6b2fbb" },
  { name: "brown", hex: "#71491e" },
  { name: "cyan", hex: "#38fedc" },
  { name: "lime", hex: "#50ef39" },
  { name: "maroon", hex: "#6b2b3c" },
  { name: "rose", hex: "#ecc0d3" },
  { name: "tan", hex: "#928776" },
] as const;
