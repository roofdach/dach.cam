"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { GameState } from "@/lib/cookie/engine";
import { formatNumber, type FormatOptions } from "@/lib/cookie/format";
import type { CookieGame } from "./runtime";

export const GameContext = createContext<CookieGame | null>(null);

export function useCookieGame(): CookieGame {
  const game = useContext(GameContext);
  if (!game) throw new Error("useCookieGame needs a <GameContext> above it.");
  return game;
}

/**
 * Reads one value out of the game and re-renders only when it changes. The
 * game ticks every frame, so a selector should return something small and
 * plain (a number, a string, a boolean), never a fresh object or array.
 */
export function useGame<T extends string | number | boolean | null | undefined>(
  select: (state: GameState, game: CookieGame) => T,
): T {
  const game = useCookieGame();
  const read = () => select(game.state, game);
  return useSyncExternalStore(game.subscribe, read, read);
}

/** Formats a number the way the player asked for in the options. */
export function useFormat() {
  const short = useGame((state) => state.settings.numbers === "short");
  return (value: number, options: Omit<FormatOptions, "short"> = {}) => formatNumber(value, { ...options, short });
}
