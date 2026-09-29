/**
 * The ship: fourteen rooms and the corridors between them, laid out on a
 * grid of tiles, with walls wherever there's no floor. You walk about it
 * freely (see lib/sus/space.ts); the room keeps track only of which zone,
 * a room or a stretch of corridor, everyone's in, which is all it needs to
 * check a kill, a report or a task (see lib/sus/room.ts).
 *
 * Positions are in units: a tile is TILE units square, and a crewmate is
 * a little under one tile across.
 */

export const TILE = 50;
export const COLS = 66;
export const ROWS = 38;
export const WIDTH = COLS * TILE;
export const HEIGHT = ROWS * TILE;

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
export const HALL_IDS = ["hall-upper", "hall-left", "hall-lower", "hall-central", "hall-weapons", "hall-o2", "hall-east", "hall-south"] as const;

export type RoomId = (typeof ROOM_IDS)[number];
export type HallId = (typeof HALL_IDS)[number];
export type ZoneId = RoomId | HallId;
export const ZONE_IDS: readonly ZoneId[] = [...ROOM_IDS, ...HALL_IDS];

/** A block of floor: column, row, width and height, in tiles. */
export type Box = readonly [number, number, number, number];

export interface Zone {
  id: ZoneId;
  name: string;
  room: boolean;
  boxes: readonly Box[];
}

const room = (id: RoomId, name: string, box: Box): Zone => ({ id, name, room: true, boxes: [box] });
const hall = (id: HallId, name: string, ...boxes: Box[]): Zone => ({ id, name, room: false, boxes });

/** Laid out the way people who've played will expect. Corridors are two tiles wide; doors can be one. */
export const ZONES: Record<ZoneId, Zone> = {
  upper: room("upper", "upper engine", [6, 2, 10, 8]),
  reactor: room("reactor", "reactor", [0, 13, 7, 12]),
  security: room("security", "security", [12, 15, 7, 7]),
  lower: room("lower", "lower engine", [6, 29, 10, 8]),
  medbay: room("medbay", "medbay", [21, 10, 8, 7]),
  electrical: room("electrical", "electrical", [21, 25, 8, 8]),
  cafeteria: room("cafeteria", "cafeteria", [31, 1, 14, 11]),
  storage: room("storage", "storage", [32, 22, 10, 14]),
  admin: room("admin", "admin", [45, 17, 8, 6]),
  comms: room("comms", "comms", [45, 32, 8, 6]),
  weapons: room("weapons", "weapons", [50, 2, 8, 8]),
  o2: room("o2", "o2", [48, 12, 6, 4]),
  navigation: room("navigation", "navigation", [60, 13, 6, 10]),
  shields: room("shields", "shields", [55, 27, 8, 8]),
  "hall-upper": hall("hall-upper", "upper corridor", [16, 5, 15, 2], [24, 7, 2, 3]),
  "hall-left": hall("hall-left", "engine corridor", [9, 10, 2, 19], [7, 18, 2, 2], [11, 18, 1, 2]),
  "hall-lower": hall("hall-lower", "lower corridor", [16, 34, 16, 2], [24, 33, 2, 1]),
  "hall-central": hall("hall-central", "admin corridor", [37, 12, 2, 10], [39, 19, 6, 2]),
  "hall-weapons": hall("hall-weapons", "weapons corridor", [45, 4, 5, 2]),
  "hall-o2": hall("hall-o2", "o2 corridor", [52, 10, 2, 2], [54, 13, 6, 2]),
  "hall-east": hall("hall-east", "navigation corridor", [60, 23, 2, 4]),
  "hall-south": hall("hall-south", "shields corridor", [42, 29, 13, 2], [48, 31, 2, 1]),
};

export const isZone = (value: unknown): value is ZoneId => typeof value === "string" && (ZONE_IDS as readonly string[]).includes(value);
export const isRoom = (value: unknown): value is RoomId => typeof value === "string" && (ROOM_IDS as readonly string[]).includes(value);

/* ---------------------------------------------------------------- grid */

/** Which zone each tile belongs to, as an index into ZONE_IDS, or -1 for wall. */
const GRID = new Int8Array(COLS * ROWS).fill(-1);
ZONE_IDS.forEach((id, i) => {
  for (const [c0, r0, w, h] of ZONES[id].boxes) {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) GRID[r * COLS + c] = i;
  }
});

export function zoneOfTile(col: number, row: number): ZoneId | null {
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return null;
  const i = GRID[row * COLS + col];
  return i < 0 ? null : ZONE_IDS[i];
}

/** The zone a point's in, or null for a wall. */
export const zoneAt = (x: number, y: number): ZoneId | null => zoneOfTile(Math.floor(x / TILE), Math.floor(y / TILE));

/** Zones next to each other: a room and the corridors off it. */
export const NEXT: Record<ZoneId, ZoneId[]> = Object.fromEntries(ZONE_IDS.map((id) => [id, [] as ZoneId[]])) as Record<ZoneId, ZoneId[]>;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const a = zoneOfTile(c, r);
    for (const b of [zoneOfTile(c + 1, r), zoneOfTile(c, r + 1)]) {
      if (a && b && a !== b && !NEXT[a].includes(b)) {
        NEXT[a].push(b);
        NEXT[b].push(a);
      }
    }
  }
}

/** How many zones apart two zones are, the shortest way round. */
const DISTANCES = new Map<ZoneId, Map<ZoneId, number>>();
for (const from of ZONE_IDS) {
  const found = new Map<ZoneId, number>([[from, 0]]);
  const queue: ZoneId[] = [from];
  while (queue.length) {
    const here = queue.shift()!;
    for (const next of NEXT[here]) {
      if (!found.has(next)) {
        found.set(next, found.get(here)! + 1);
        queue.push(next);
      }
    }
  }
  DISTANCES.set(from, found);
}
export const hops = (a: ZoneId, b: ZoneId) => DISTANCES.get(a)?.get(b) ?? Infinity;

/** A zone's middle, or its first block's if it's a corridor of several. */
export function centerOf(zone: ZoneId) {
  const [c, r, w, h] = ZONES[zone].boxes[0];
  return { x: (c + w / 2) * TILE, y: (r + h / 2) * TILE };
}

/* --------------------------------------------------------------- spots */

/** The middle of a tile, in units. */
const at = (col: number, row: number) => ({ x: (col + 0.5) * TILE, y: (row + 0.5) * TILE });

export interface Point {
  x: number;
  y: number;
}

/** The kinds of little job a task is; each is a small game of its own in the browser. */
export type TaskKind = "wires" | "swipe" | "download" | "hold" | "simon" | "numbers" | "scan" | "asteroids" | "shields" | "course" | "steer" | "filter" | "align";

export interface Task extends Point {
  id: string;
  name: string;
  room: RoomId;
  kind: TaskKind;
  /** The least time it can take, from getting to the room (or getting on the scanner): quicker than this isn't doing it. */
  min: number;
}

const task = (id: string, name: string, roomId: RoomId, kind: TaskKind, min: number, col: number, row: number): Task => ({ id, name, room: roomId, kind, min, ...at(col, row) });

export const TASKS: readonly Task[] = [
  task("wires-electrical", "fix wiring", "electrical", "wires", 2000, 22, 26),
  task("wires-security", "fix wiring", "security", "wires", 2000, 17, 16),
  task("card", "swipe card", "admin", "swipe", 1000, 51, 18),
  task("upload", "upload data", "admin", "download", 6000, 46, 21),
  task("download", "download data", "comms", "download", 6000, 51, 36),
  task("garbage", "empty garbage", "cafeteria", "hold", 3000, 43, 2),
  task("chute", "empty chute", "o2", "hold", 3000, 48, 15),
  task("fuel", "fuel engines", "storage", "hold", 3000, 38, 33),
  task("reactor", "start reactor", "reactor", "simon", 3000, 1, 14),
  task("manifolds", "unlock manifolds", "reactor", "numbers", 2000, 1, 23),
  // The one everyone can watch you do: impostors can't.
  task("scan", "submit scan", "medbay", "scan", 8000, 27, 15),
  task("asteroids", "clear asteroids", "weapons", "asteroids", 4000, 56, 3),
  task("shields", "prime shields", "shields", "shields", 1500, 61, 33),
  task("course", "chart course", "navigation", "course", 1500, 64, 18),
  task("steering", "stabilize steering", "navigation", "steer", 500, 64, 14),
  task("filter", "clean o2 filter", "o2", "filter", 1500, 51, 15),
  task("align-upper", "align engine output", "upper", "align", 1000, 7, 3),
  task("align-lower", "align engine output", "lower", "align", 1000, 7, 35),
];

export const TASK_BY_ID: ReadonlyMap<string, Task> = new Map(TASKS.map((t) => [t.id, t]));

export interface Vent extends Point {
  id: string;
  zone: RoomId;
  /** Where you can get to from it, without being seen in between. */
  links: string[];
}

const vent = (id: RoomId, col: number, row: number, links: RoomId[]): Vent => ({ id, zone: id, links, ...at(col, row) });

/** A vent in each of eleven rooms, joined up as on the ship people know. Impostors only. */
export const VENTS: readonly Vent[] = [
  vent("upper", 14, 8, ["reactor"]),
  vent("reactor", 3, 18, ["upper", "lower"]),
  vent("lower", 14, 30, ["reactor"]),
  vent("medbay", 22, 15, ["security", "electrical"]),
  vent("security", 16, 20, ["medbay", "electrical"]),
  vent("electrical", 26, 31, ["medbay", "security"]),
  vent("cafeteria", 43, 10, ["admin"]),
  vent("admin", 48, 18, ["cafeteria"]),
  vent("weapons", 51, 8, ["navigation"]),
  vent("navigation", 61, 21, ["weapons", "shields"]),
  vent("shields", 56, 33, ["navigation"]),
];

export const VENT_BY_ID: ReadonlyMap<string, Vent> = new Map(VENTS.map((v) => [v.id, v]));

/** Where things that aren't tasks are done. */
export const SPOTS = {
  /** The emergency button, on the cafeteria table. */
  button: { ...at(37.5, 6), zone: "cafeteria" },
  /** Admin's map table: how many are in each room. */
  table: { ...at(48.5, 19.5), zone: "admin" },
  /** The desk in security that shows the cameras. */
  cameras: { ...at(13, 20), zone: "security" },
  /** Where the lights are fixed. */
  lights: { ...at(27, 26), zone: "electrical" },
  /** The two hand scanners that stop a meltdown. */
  reactor: [
    { ...at(5, 15), zone: "reactor" },
    { ...at(5, 22), zone: "reactor" },
  ],
} as const satisfies Record<string, (Point & { zone: ZoneId }) | readonly (Point & { zone: ZoneId })[]>;

/** Where everyone stands at the start and after each meeting: round the cafeteria table. */
export const SEATS: readonly Point[] = Array.from({ length: 15 }, (_, i) => {
  const angle = -Math.PI / 2 + (i / 15) * Math.PI * 2;
  return { x: SPOTS.button.x + Math.cos(angle) * 170, y: SPOTS.button.y + Math.sin(angle) * 150 };
});

export interface Camera {
  id: string;
  name: string;
  /** What it shows, in units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The cameras security watches: the corridors everyone has to use. */
export const CAMERAS: readonly Camera[] = [
  { id: "upper", name: "upper corridor", x: 950, y: 150, w: 600, h: 400 },
  { id: "admin", name: "admin corridor", x: 1650, y: 750, w: 600, h: 400 },
  { id: "navigation", name: "navigation corridor", x: 2550, y: 500, w: 600, h: 400 },
  { id: "shields", name: "shields corridor", x: 2150, y: 1300, w: 600, h: 400 },
];

export const inCamera = (camera: Camera, p: Point) => p.x >= camera.x && p.x < camera.x + camera.w && p.y >= camera.y && p.y < camera.y + camera.h;

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
