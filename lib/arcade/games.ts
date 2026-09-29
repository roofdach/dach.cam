/**
 * The arcade games, as the server sees them: how to tidy a run as sent,
 * and how to play it back to find out what it really scored. Nothing a
 * browser says it scored is believed; only what its moves come to.
 */

import * as flap from "../flap/game.ts";
import * as snake from "../snake/game.ts";

export type ArcadeGame = "flap" | "snake";
export const ARCADE_GAMES: readonly ArcadeGame[] = ["flap", "snake"];
export const isArcadeGame = (value: unknown): value is ArcadeGame => value === "flap" || value === "snake";

export interface Outcome {
  score: number;
  /** How long it lasted: ticks for a bird, steps for a snake. Breaks ties. */
  length: number;
  /** Whether it ended, rather than being stopped. */
  over: boolean;
  /** The least time it could have taken to play, in milliseconds. */
  ms: number;
}

/** A run played back, or null if its moves can't be moves. `limit` stops it early, as a race's clock does. */
export function outcome(game: ArcadeGame, seed: string, moves: unknown, limitMs = Infinity): Outcome | null {
  if (game === "flap") {
    const limit = Math.min(flap.MAX_TICKS, Math.floor(limitMs / flap.TICK_MS));
    const flaps = flap.cleanFlaps(moves, flap.MAX_TICKS);
    if (!flaps) return null;
    const bird = flap.replay(seed, flaps, limit);
    return { score: bird.score, length: bird.tick, over: bird.dead, ms: bird.tick * flap.TICK_MS };
  }
  const turns = snake.cleanTurns(moves);
  if (!turns) return null;
  const { snake: s, ms } = snake.replay(seed, turns, limitMs);
  return { score: s.score, length: s.step, over: s.dead, ms };
}
