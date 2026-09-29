"use client";

import { randomId } from "@/lib/random";
import type { ArcadeGame } from "@/lib/arcade/games";
import type { Boards } from "@/lib/arcade/scores";
import type { Submitted, Ticket } from "@/lib/arcade/server/scores";
import { KEYS, isString, load, save } from "@/components/game/storage";

/**
 * A browser's side of the high score boards: the secret that stands for
 * you (kept on this device, never shown), a ticket before each run, and the
 * run's moves after (see lib/arcade/server/scores.ts).
 */

export function playerSecret(): string {
  const saved = load(KEYS.arcadePlayer, isString);
  if (saved && /^[a-z0-9]{16,64}$/.test(saved)) return saved;
  const fresh = randomId(24);
  save(KEYS.arcadePlayer, fresh);
  return fresh;
}

/** How you appear on the boards: the same hash the server makes of your secret. */
export async function whoAmI(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`arcade:${playerSecret()}`));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fetchBoards(game: ArcadeGame): Promise<Boards | null> {
  try {
    const response = await fetch(`/api/${game}/scores`, { headers: { Accept: "application/json" } });
    return response.ok ? ((await response.json()) as Boards) : null;
  } catch {
    return null;
  }
}

/** A ticket for the next run; null when the boards can't be reached, and the run just won't count. */
export async function fetchTicket(game: ArcadeGame): Promise<Ticket | null> {
  try {
    const response = await fetch(`/api/${game}/scores`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "ticket" }) });
    return response.ok ? ((await response.json()) as Ticket) : null;
  } catch {
    return null;
  }
}

export async function submitRun(game: ArcadeGame, ticket: Ticket, moves: unknown, name: string): Promise<Submitted | { error: string }> {
  try {
    const response = await fetch(`/api/${game}/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "submit", ticket, moves, name, player: playerSecret() }),
    });
    const body = (await response.json().catch(() => null)) as (Submitted & { error?: string }) | null;
    if (!response.ok || !body) return { error: body?.error ?? "couldn't reach the boards" };
    return body;
  } catch {
    return { error: "couldn't reach the boards; check your connection" };
  }
}

export const loadBest = (game: ArcadeGame) => load(KEYS.arcadeBest(game), (v): v is number => typeof v === "number") ?? 0;
export const saveBest = (game: ArcadeGame, score: number) => save(KEYS.arcadeBest(game), score);
