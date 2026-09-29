/**
 * A snake, as sums anyone can do again: the same seed and the same turns,
 * step by step, always come out the same, so a score can be checked by
 * playing it back (see lib/arcade/games.ts). The board is 17 by 15; apples
 * are worth one and make you longer, and every fifth apple brings a golden
 * one for a while, worth three. The more you eat, the faster you go.
 */

import { seededRandom, type Random } from "../random.ts";

export const COLS = 17;
export const ROWS = 15;
export const CELLS = COLS * ROWS;
export type Dir = 0 | 1 | 2 | 3;
/** Up, right, down, left. */
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const opposite = (a: Dir, b: Dir) => (a + 2) % 4 === b;
export const isDir = (value: unknown): value is Dir => value === 0 || value === 1 || value === 2 || value === 3;
/** How long a golden apple stays, in steps. */
export const GOLD_STEPS = 45;
export const MAX_STEPS = 40_000;

export interface Snake {
  step: number;
  /** Cells, head first; a cell is row * COLS + column. */
  body: number[];
  dir: Dir;
  apple: number;
  gold: { cell: number; until: number } | null;
  score: number;
  /** Apples eaten, golden ones not counted: what sets the speed. */
  eaten: number;
  dead: boolean;
  /** Filled the whole board. */
  won: boolean;
}

export const cell = (col: number, row: number) => row * COLS + col;

/** How long a step takes, in milliseconds: quicker with every apple, down to fourteen a second. */
export const stepMs = (snake: Pick<Snake, "eaten">) => Math.max(70, 135 - snake.eaten * 2.5);

export class Game {
  readonly snake: Snake;
  private readonly random: Random;

  constructor(seed: string) {
    this.random = seededRandom(`snake:${seed}`);
    const row = Math.floor(ROWS / 2);
    // The first apple's always in the same place, straight ahead.
    this.snake = { step: 0, body: [cell(4, row), cell(3, row), cell(2, row)], dir: 1, apple: cell(12, row), gold: null, score: 0, eaten: 0, dead: false, won: false };
  }

  /** Somewhere free: not the snake, nor either apple. */
  private spawn(): number {
    const s = this.snake;
    const taken = new Uint8Array(CELLS);
    for (const c of s.body) taken[c] = 1;
    if (s.apple >= 0) taken[s.apple] = 1;
    if (s.gold) taken[s.gold.cell] = 1;
    let free = 0;
    for (let c = 0; c < CELLS; c++) if (!taken[c]) free++;
    if (free === 0) return -1;
    let pick = Math.floor(this.random() * free);
    for (let c = 0; c < CELLS; c++) {
      if (taken[c]) continue;
      if (pick-- === 0) return c;
    }
    return -1;
  }

  /** One step, turning first if `turn` is a way it can turn. */
  step(turn?: Dir): void {
    const s = this.snake;
    if (s.dead) return;
    if (turn !== undefined && turn !== s.dir && !opposite(turn, s.dir)) s.dir = turn;
    const head = s.body[0];
    const col = (head % COLS) + DX[s.dir];
    const row = Math.floor(head / COLS) + DY[s.dir];
    s.step++;
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) {
      s.dead = true;
      return;
    }
    const next = cell(col, row);
    const golden = s.gold !== null && next === s.gold.cell;
    const eating = next === s.apple || golden;
    // The tail moves out of the way, unless it's growing.
    const tail = s.body.length - 1;
    for (let i = 0; i < s.body.length; i++) {
      if (s.body[i] === next && !(i === tail && !eating)) {
        s.dead = true;
        return;
      }
    }
    s.body.unshift(next);
    if (!eating) s.body.pop();
    if (golden) {
      s.score += 3;
      s.gold = null;
    } else if (next === s.apple) {
      s.score += 1;
      s.eaten += 1;
      s.apple = -1;
      s.apple = this.spawn();
      if (s.eaten % 5 === 0 && !s.gold) {
        const where = this.spawn();
        if (where >= 0) s.gold = { cell: where, until: s.step + GOLD_STEPS };
      }
    }
    if (s.gold && s.step >= s.gold.until) s.gold = null;
    if (s.body.length === CELLS) {
      s.won = true;
      s.dead = true;
    }
  }
}

/** Turns as sent: the step each came before, and which way. Null if they can't be. */
export function cleanTurns(value: unknown, limit = MAX_STEPS): [number, Dir][] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  let last = -1;
  for (const turn of value) {
    if (!Array.isArray(turn) || turn.length !== 2) return null;
    const [at, dir] = turn;
    if (!Number.isInteger(at) || at <= last || at >= limit || !isDir(dir)) return null;
    last = at;
  }
  return value as [number, Dir][];
}

/** Plays a game back, stopping as a race's clock would at `limitMs`: where it ended, and the least time it could have taken. */
export function replay(seed: string, turns: readonly (readonly [number, Dir])[], limitMs = Infinity): { snake: Snake; ms: number } {
  const game = new Game(seed);
  const s = game.snake;
  let next = 0;
  let ms = 0;
  while (!s.dead && s.step < MAX_STEPS && ms + stepMs(s) <= limitMs) {
    let turn: Dir | undefined;
    if (next < turns.length && turns[next][0] === s.step) turn = turns[next++][1];
    ms += stepMs(s);
    game.step(turn);
  }
  return { snake: s, ms };
}

/** A snake squeezed into a few characters, for others to draw: its head, then which way each piece goes from the one before. */
export function packBody(body: readonly number[]): string {
  let out = body[0].toString(36).padStart(2, "0");
  for (let i = 1; i < body.length; i++) {
    const d = body[i] - body[i - 1];
    out += d === -COLS ? "u" : d === 1 ? "r" : d === COLS ? "d" : "l";
  }
  return out;
}

export function unpackBody(text: string): number[] {
  const head = parseInt(text.slice(0, 2), 36);
  if (!Number.isInteger(head) || head < 0 || head >= CELLS) return [];
  const body = [head];
  for (const c of text.slice(2, CELLS + 2)) {
    const last = body[body.length - 1];
    body.push(last + (c === "u" ? -COLS : c === "r" ? 1 : c === "d" ? COLS : -1));
  }
  return body;
}
