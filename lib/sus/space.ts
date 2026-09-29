/**
 * Walking about the ship: bumping into walls and sliding along them, what
 * you can see from where you are, and how close is close enough to do
 * something. The same in every browser; the room itself only checks zones
 * (see lib/sus/room.ts).
 */

import { COLS, HEIGHT, ROWS, TILE, WIDTH, zoneOfTile, type Point } from "./ship.ts";

/** Half a crewmate's width, in units. */
export const RADIUS = 18;
/** Units a second. */
export const SPEED = 290;
export const GHOST_SPEED = 420;
/** How close you need to be to kill, report a body, or use something. */
export const KILL_RANGE = 115;
export const REPORT_RANGE = 140;
export const USE_RANGE = 95;
/** How far you can see: crew, crew with the lights out, and impostors, who see in the dark. */
export const VISION = { crew: 380, dark: 130, impostor: 500 } as const;

const floorTile = (col: number, row: number) => zoneOfTile(col, row) !== null;
const floor = (x: number, y: number) => floorTile(Math.floor(x / TILE), Math.floor(y / TILE));

/** Whether a crewmate fits here: all four corners of their square on the floor. They're narrower than a tile, so nothing gets between the corners. */
export const fits = (x: number, y: number, r = RADIUS) => floor(x - r, y - r) && floor(x + r, y - r) && floor(x - r, y + r) && floor(x + r, y + r);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Moves someone by (dx, dy), sliding along any wall in the way: across
 * first, then up or down, a few units at a time so nothing's jumped. Ghosts
 * go through walls.
 */
export function step(from: Point, dx: number, dy: number, ghost = false): Point {
  if (ghost) return { x: clamp(from.x + dx, 0, WIDTH), y: clamp(from.y + dy, 0, HEIGHT) };
  let { x, y } = from;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
  for (let i = 0; i < steps; i++) {
    const nx = x + dx / steps;
    if (fits(nx, y)) x = nx;
    const ny = y + dy / steps;
    if (fits(x, ny)) y = ny;
  }
  return { x, y };
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/* --------------------------------------------------------------- walls */

export type Segment = readonly [number, number, number, number];

/** The edges between floor and wall, joined into straight runs. */
function traceWalls(): Segment[] {
  const out: Segment[] = [];
  for (let r = 0; r <= ROWS; r++) {
    let start = -1;
    for (let c = 0; c <= COLS; c++) {
      const edge = c < COLS && floorTile(c, r - 1) !== floorTile(c, r);
      if (edge && start < 0) start = c;
      if (!edge && start >= 0) {
        out.push([start * TILE, r * TILE, c * TILE, r * TILE]);
        start = -1;
      }
    }
  }
  for (let c = 0; c <= COLS; c++) {
    let start = -1;
    for (let r = 0; r <= ROWS; r++) {
      const edge = r < ROWS && floorTile(c - 1, r) !== floorTile(c, r);
      if (edge && start < 0) start = r;
      if (!edge && start >= 0) {
        out.push([c * TILE, start * TILE, c * TILE, r * TILE]);
        start = -1;
      }
    }
  }
  return out;
}

export const WALLS: readonly Segment[] = traceWalls();

/** The walls filed by which square of the ship they pass through, so a look round only checks the ones nearby. */
const CELL = 200;
const CELL_COLS = Math.ceil(WIDTH / CELL) + 1;
const CELLS = new Map<number, Segment[]>();
for (const wall of WALLS) {
  const [x1, y1, x2, y2] = wall;
  for (let cx = Math.floor(Math.min(x1, x2) / CELL); cx <= Math.floor(Math.max(x1, x2) / CELL); cx++) {
    for (let cy = Math.floor(Math.min(y1, y2) / CELL); cy <= Math.floor(Math.max(y1, y2) / CELL); cy++) {
      const key = cy * CELL_COLS + cx;
      const list = CELLS.get(key) ?? [];
      list.push(wall);
      CELLS.set(key, list);
    }
  }
}

/** Walls that might cross the box from (x1, y1) to (x2, y2). */
export function wallsNear(x1: number, y1: number, x2: number, y2: number): Segment[] {
  const found = new Set<Segment>();
  for (let cx = Math.floor(Math.min(x1, x2) / CELL); cx <= Math.floor(Math.max(x1, x2) / CELL); cx++) {
    for (let cy = Math.floor(Math.min(y1, y2) / CELL); cy <= Math.floor(Math.max(y1, y2) / CELL); cy++) {
      for (const wall of CELLS.get(cy * CELL_COLS + cx) ?? []) found.add(wall);
    }
  }
  return [...found];
}

/** Where along a ray from (ox, oy) heading (dx, dy) it meets a wall, as a multiple of (dx, dy); Infinity if it doesn't. */
function hit(ox: number, oy: number, dx: number, dy: number, [x1, y1, x2, y2]: Segment): number {
  const sx = x2 - x1;
  const sy = y2 - y1;
  const denominator = dx * sy - dy * sx;
  if (Math.abs(denominator) < 1e-9) return Infinity;
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / denominator;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denominator;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

/** Whether nothing but floor lies between two points. */
export function sightLine(a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const wall of wallsNear(a.x, a.y, b.x, b.y)) if (hit(a.x, a.y, dx, dy, wall) < 1) return false;
  return true;
}

/** Whether someone at `eye` who can see `range` units would see `p`. */
export const canSee = (eye: Point, p: Point, range: number) => distance(eye, p) <= range && sightLine(eye, p);

/**
 * What can be seen from `eye` out to `range`, as a polygon: rays cast at
 * every corner of every wall nearby, and just either side of it, where the
 * edge of sight crosses a wall, and round a circle where there's nothing in
 * the way.
 */
export function visibility(eye: Point, range: number): Point[] {
  const walls = wallsNear(eye.x - range, eye.y - range, eye.x + range, eye.y + range);
  const angles: number[] = [];
  for (let k = 0; k < 72; k++) angles.push(-Math.PI + (k / 72) * Math.PI * 2);
  for (const [x1, y1, x2, y2] of walls) {
    for (const [x, y] of [
      [x1, y1],
      [x2, y2],
    ]) {
      if (Math.hypot(x - eye.x, y - eye.y) > range + TILE) continue;
      const a = Math.atan2(y - eye.y, x - eye.x);
      angles.push(a - 1e-4, a, a + 1e-4);
    }
    // And where the edge of sight crosses the wall, so the dark doesn't cut the corner between two rays.
    const dx = x2 - x1;
    const dy = y2 - y1;
    const fx = x1 - eye.x;
    const fy = y1 - eye.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const disc = b * b - 4 * a * (fx * fx + fy * fy - range * range);
    if (a === 0 || disc < 0) continue;
    for (const sign of [-1, 1]) {
      const u = (-b + sign * Math.sqrt(disc)) / (2 * a);
      if (u >= 0 && u <= 1) angles.push(Math.atan2(fy + u * dy, fx + u * dx));
    }
  }
  angles.sort((a, b) => a - b);
  return angles.map((angle) => {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let t = range;
    for (const wall of walls) t = Math.min(t, hit(eye.x, eye.y, dx, dy, wall));
    return { x: eye.x + dx * t, y: eye.y + dy * t };
  });
}
