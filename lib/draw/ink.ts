/**
 * A drawing, as a list of small operations the drawer's browser sends a few
 * times a second and everyone else replays: lines, fills, clears and undos.
 * Coordinates are on a fixed 800 by 600 board, whatever size it shows at, so
 * every screen draws the same picture and a fill spreads the same way.
 */

export const WIDTH = 800;
export const HEIGHT = 600;

/** The palette: two rows, light shades then dark, like the game this is after. */
export const COLORS = [
  "#ffffff", "#c1c1c1", "#ef130b", "#ff7100", "#ffe400", "#00cc00", "#00b2ff", "#231fd3", "#a300ba", "#d37caa", "#a0522d", "#fcc2a1",
  "#000000", "#4c4c4c", "#740b07", "#c23800", "#e8a200", "#005510", "#00569e", "#0e0865", "#550069", "#a75574", "#63300d", "#c77a5b",
] as const;

export const WHITE = 0;
export const BLACK = 12;

/** Brush widths on the board. */
export const SIZES = [4, 10, 20, 40] as const;

/**
 * One operation. Every one but an undo carries the number of the stroke it
 * belongs to, so an undo can take back a whole stroke, however many batches
 * it was sent in.
 *
 * - `["l", stroke, color, size, x0, y0, x1, y1, ...]`, a line through points
 * - `["f", stroke, color, x, y]`, a fill from a point
 * - `["c", stroke]`, wipe the board
 * - `["u", stroke]`, take a stroke back
 *
 * An undo names the stroke it takes back, rather than meaning "the latest",
 * so a batch that arrives twice (a retry after a timeout) changes nothing.
 */
export type Op = ["l", number, number, number, ...number[]] | ["f", number, number, number, number] | ["c", number] | ["u", number];

/** The most one request may carry: a few seconds of fast scribbling. */
export const MAX_OPS_PER_BATCH = 120;
export const MAX_POINTS_PER_BATCH = 3000;
/** Enough for about three minutes of nonstop drawing at three batches a second. */
export const MAX_BATCHES_PER_TURN = 600;

const inside = (x: unknown, y: unknown) =>
  Number.isInteger(x) && Number.isInteger(y) && (x as number) >= 0 && (x as number) <= WIDTH && (y as number) >= 0 && (y as number) <= HEIGHT;
const strokeId = (id: unknown) => Number.isInteger(id) && (id as number) >= 0 && (id as number) < 1_000_000;
const color = (c: unknown) => Number.isInteger(c) && (c as number) >= 0 && (c as number) < COLORS.length;

export function isOp(value: unknown): value is Op {
  if (!Array.isArray(value) || value.length === 0) return false;
  switch (value[0]) {
    case "l": {
      const [, id, c, size, ...points] = value;
      if (!strokeId(id) || !color(c) || !(Number.isInteger(size) && size >= 0 && size < SIZES.length)) return false;
      if (points.length < 2 || points.length % 2 !== 0) return false;
      for (let i = 0; i < points.length; i += 2) if (!inside(points[i], points[i + 1])) return false;
      return true;
    }
    case "f":
      return value.length === 5 && strokeId(value[1]) && color(value[2]) && inside(value[3], value[4]);
    case "c":
    case "u":
      return value.length === 2 && strokeId(value[1]);
    default:
      return false;
  }
}

/** A batch fit to store: well-formed operations, and not too many of them. */
export function isBatch(value: unknown): value is Op[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_OPS_PER_BATCH) return false;
  let points = 0;
  for (const op of value) {
    if (!isOp(op)) return false;
    if (op[0] === "l") points += (op.length - 4) / 2;
  }
  return points <= MAX_POINTS_PER_BATCH;
}

/** The operations still showing once every undo has taken its stroke back. */
export function visible(ops: readonly Op[]): Op[] {
  const undone = new Set<number>();
  for (const op of ops) if (op[0] === "u") undone.add(op[1]);
  return ops.filter((op) => op[0] !== "u" && !undone.has(op[1]));
}

/** The stroke an undo would take back now: the latest one still showing. */
export function lastStroke(ops: readonly Op[]): number | null {
  let latest: number | null = null;
  for (const op of visible(ops)) latest = Math.max(latest ?? -1, op[1]);
  return latest;
}

/** The number the next stroke gets: one past any stroke so far, undone or not. */
export function nextStroke(ops: readonly Op[]): number {
  let next = 0;
  for (const op of ops) next = Math.max(next, op[1] + 1);
  return next;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Paint bucket: fills the region around a point that is close in colour to
 * that point, scanline by scanline. The tolerance swallows the soft edges
 * that smoothing leaves along lines, so a fill doesn't leave a pale halo.
 */
export function floodFill(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, fill: string, tolerance = 48): void {
  const sx = Math.min(width - 1, Math.max(0, Math.round(x)));
  const sy = Math.min(height - 1, Math.max(0, Math.round(y)));
  const start = (sy * width + sx) * 4;
  const target = [pixels[start], pixels[start + 1], pixels[start + 2]];
  const [r, g, b] = rgb(fill);
  if (Math.abs(target[0] - r) <= 2 && Math.abs(target[1] - g) <= 2 && Math.abs(target[2] - b) <= 2) return;

  const matches = (i: number) =>
    Math.abs(pixels[i] - target[0]) <= tolerance && Math.abs(pixels[i + 1] - target[1]) <= tolerance && Math.abs(pixels[i + 2] - target[2]) <= tolerance;
  const seen = new Uint8Array(width * height);
  const stack = [sx, sy];
  while (stack.length > 0) {
    const py = stack.pop()!;
    let px = stack.pop()!;
    while (px > 0 && !seen[py * width + px - 1] && matches((py * width + px - 1) * 4)) px--;
    let above = false;
    let below = false;
    for (; px < width; px++) {
      const cell = py * width + px;
      if (seen[cell] || !matches(cell * 4)) break;
      seen[cell] = 1;
      const i = cell * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
      if (py > 0) {
        const up = cell - width;
        const open = !seen[up] && matches(up * 4);
        if (open && !above) stack.push(px, py - 1);
        above = open;
      }
      if (py < height - 1) {
        const down = cell + width;
        const open = !seen[down] && matches(down * 4);
        if (open && !below) stack.push(px, py + 1);
        below = open;
      }
    }
  }
}
