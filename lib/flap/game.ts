/**
 * A flappy bird, as sums anyone can do again: the same course and the same
 * flaps, tick by tick, always come out the same, so a score can be checked
 * by playing it back (see lib/arcade/games.ts). Sixty ticks a second, in
 * the pixels of a 288 by 512 screen. Only adding, multiplying and rounding,
 * which every browser and server does the same way to the last bit.
 */

import { seededRandom, type Random } from "../random.ts";

export const TICK_MS = 1000 / 60;
export const WIDTH = 288;
export const HEIGHT = 512;
/** Where the ground starts. */
export const GROUND = 440;
export const BIRD_X = 80;
export const BIRD_R = 12;
const GRAVITY = 0.42;
const FLAP = -7.2;
const MAX_FALL = 9.5;
export const PIPE_W = 52;
export const PIPE_SPEED = 2;
/** From one pipe to the next. */
export const PIPE_EVERY = 168;
const FIRST_PIPE = WIDTH + 90;
/** Half an hour, which nobody's going to get near. */
export const MAX_TICKS = 60 * 60 * 30;

export interface Pipe {
  /** Its left edge, along the course. */
  x: number;
  /** The gap: its top and bottom. */
  top: number;
  bottom: number;
}

/** The pipes for one seed, made as they're needed. */
export class Course {
  private readonly random: Random;
  private readonly pipes: Pipe[] = [];

  constructor(seed: string) {
    this.random = seededRandom(`flap:${seed}`);
  }

  pipe(i: number): Pipe {
    while (this.pipes.length <= i) this.pipes.push(this.make(this.pipes.length));
    return this.pipes[i];
  }

  private make(i: number): Pipe {
    // The gap closes a little every five pipes, down to a hundred.
    const gap = Math.max(100, 138 - Math.floor(i / 5) * 4);
    const lowest = 56;
    const highest = GROUND - 56 - gap;
    let top = lowest + Math.floor(this.random() * (highest - lowest + 1));
    // Never so far from the last gap you can't get there.
    const last = this.pipes[i - 1];
    if (last) top = Math.max(last.top - 150, Math.min(last.top + 150, top));
    return { x: FIRST_PIPE + i * PIPE_EVERY, top, bottom: top + gap };
  }
}

export interface Bird {
  tick: number;
  y: number;
  vy: number;
  score: number;
  dead: boolean;
}

export const startBird = (): Bird => ({ tick: 0, y: 215, vy: 0, score: 0, dead: false });

/** How far along the course the screen's left edge is. */
export const scroll = (tick: number) => tick * PIPE_SPEED;

/** The pipes that could be on screen at a tick, by index. */
export function pipesOnScreen(tick: number): [number, number] {
  const left = scroll(tick);
  const first = Math.max(0, Math.floor((left - FIRST_PIPE - PIPE_W) / PIPE_EVERY) + 1);
  const last = Math.max(-1, Math.floor((left + WIDTH - FIRST_PIPE) / PIPE_EVERY));
  return [first, last];
}

function hits(cx: number, cy: number, pipe: Pipe): boolean {
  if (cx + BIRD_R <= pipe.x || cx - BIRD_R >= pipe.x + PIPE_W) return false;
  const nx = Math.max(pipe.x, Math.min(cx, pipe.x + PIPE_W));
  const dx = cx - nx;
  if (cy - BIRD_R < pipe.top) {
    const dy = cy - Math.min(cy, pipe.top);
    if (dx * dx + dy * dy < BIRD_R * BIRD_R) return true;
  }
  if (cy + BIRD_R > pipe.bottom) {
    const dy = cy - Math.max(cy, pipe.bottom);
    if (dx * dx + dy * dy < BIRD_R * BIRD_R) return true;
  }
  return false;
}

/** One tick: a flap if there is one, gravity if not, then whatever the bird hit. */
export function step(bird: Bird, course: Course, flap: boolean): void {
  if (bird.dead) return;
  bird.vy = flap ? FLAP : Math.min(MAX_FALL, bird.vy + GRAVITY);
  bird.y += bird.vy;
  bird.tick++;
  // The top of the screen is a ceiling, not a way round.
  if (bird.y < BIRD_R) {
    bird.y = BIRD_R;
    bird.vy = Math.max(0, bird.vy);
  }
  if (bird.y + BIRD_R >= GROUND) {
    bird.y = GROUND - BIRD_R;
    bird.dead = true;
    return;
  }
  const x = BIRD_X + scroll(bird.tick);
  for (let i = Math.max(0, Math.floor((x - BIRD_R - FIRST_PIPE - PIPE_W) / PIPE_EVERY)); ; i++) {
    const pipe = course.pipe(i);
    if (pipe.x > x + BIRD_R) break;
    if (hits(x, bird.y, pipe)) {
      bird.dead = true;
      return;
    }
  }
  // A pipe counts once the bird's past its middle.
  bird.score = Math.max(0, Math.floor((x - FIRST_PIPE - PIPE_W / 2) / PIPE_EVERY) + 1);
}

/** Flaps as sent: the ticks they came on, in order, starting with the one that started it. Null if they can't be. */
export function cleanFlaps(value: unknown, limit = MAX_TICKS): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > limit / 2) return null;
  let last = -1;
  for (const tick of value) {
    if (!Number.isInteger(tick) || tick <= last || tick >= limit) return null;
    last = tick;
  }
  return value[0] === 0 ? (value as number[]) : null;
}

/** Plays a run back: where it ended, and how. */
export function replay(seed: string, flaps: readonly number[], limit = MAX_TICKS): Bird {
  const course = new Course(seed);
  const bird = startBird();
  let next = 0;
  while (!bird.dead && bird.tick < limit) {
    const flap = flaps[next] === bird.tick;
    if (flap) next++;
    step(bird, course, flap);
  }
  return bird;
}
