/**
 * What the high score API does, apart from HTTP. Before a run, a browser
 * asks for a ticket: a course for the run, when it was handed out, and a
 * signature over both, so nobody can pick an easy course or say they
 * started earlier than they did. After, it sends the ticket and its moves.
 * The run is played back here (see lib/arcade/games.ts), and only what it
 * really comes to goes on the boards, if it could have been played in the
 * time since.
 */

import { randomId } from "../../random.ts";
import { cleanName } from "../../rooms/codes.ts";
import { RoomError, record } from "../../rooms/http.ts";
import { toBase64 } from "../../rooms/seats.ts";
import { upstashFromEnv } from "../../rooms/store.ts";
import { outcome, type ArcadeGame } from "../games.ts";
import { dayOf, type Boards, type ScoreStore, type Standing } from "../scores.ts";

export interface Ticket {
  seed: string;
  t: number;
  mac: string;
}

/** How long a ticket's good for: longer than anyone plays one run. */
const TICKET_MS = 3 * 60 * 60 * 1000;
const encoder = new TextEncoder();

/**
 * What tickets are signed with: a secret of its own if the site has one,
 * or else the database's token, which only the server knows. Without a
 * database there are no boards to protect.
 */
export function ticketSecret(env: Record<string, string | undefined> = process.env): string {
  return env.ARCADE_SECRET?.trim() || upstashFromEnv(env)?.token || "boards only live here while you try things out";
}

async function macFor(secret: string, game: ArcadeGame, seed: string, t: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64(await crypto.subtle.sign("HMAC", key, encoder.encode(`${game}:${seed}:${t}`)));
}

export async function issueTicket(game: ArcadeGame, now: number, secret: string): Promise<Ticket> {
  const seed = randomId(12);
  return { seed, t: now, mac: await macFor(secret, game, seed, now) };
}

async function checkTicket(game: ArcadeGame, value: unknown, now: number, secret: string): Promise<Ticket> {
  const ticket = value as Partial<Ticket> | null;
  const ok =
    !!ticket &&
    typeof ticket.seed === "string" &&
    /^[a-z0-9]{12}$/.test(ticket.seed) &&
    typeof ticket.t === "number" &&
    typeof ticket.mac === "string" &&
    ticket.mac === (await macFor(secret, game, ticket.seed, ticket.t));
  if (!ok) throw new RoomError(400, "that run's ticket isn't one of ours");
  if (now - ticket.t! > TICKET_MS || ticket.t! > now + 5000) throw new RoomError(409, "that run's ticket has run out; play another");
  return ticket as Ticket;
}

/** The hash of a player's secret that stands for them on the boards; browsers work out their own the same way, to spot themselves. */
async function whoFor(secret: unknown): Promise<string> {
  if (typeof secret !== "string" || !/^[a-z0-9]{16,64}$/.test(secret)) throw new RoomError(400, "that request made no sense");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`arcade:${secret}`));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Submitted {
  score: number;
  /** Where you stand now; null when the run scored nothing, so it wasn't kept. */
  standing: Standing | null;
  boards: Boards;
  who: string;
}

export async function submitRun(store: ScoreStore, game: ArcadeGame, input: unknown, now: number, secret: string): Promise<Submitted> {
  const body = record(input);
  const ticket = await checkTicket(game, body.ticket, now, secret);
  const name = cleanName(body.name);
  if (!name) throw new RoomError(400, "pick a name first");
  const who = await whoFor(body.player);
  const run = outcome(game, ticket.seed, body.moves);
  if (!run) throw new RoomError(400, "those moves don't make a run");
  if (!run.over) throw new RoomError(409, "that run isn't over yet");
  // A little slack for a clock that runs fast, and nothing for one that's faster than that.
  if (run.ms * 0.8 > now - ticket.t + 2000) throw new RoomError(409, "that run went quicker than it could have");
  const day = dayOf(now);
  const standing = run.score > 0 ? await store.submit(game, who, name, run.score, day) : null;
  return { score: run.score, standing, boards: await store.boards(game, day), who };
}

export function getBoards(store: ScoreStore, game: ArcadeGame, now: number): Promise<Boards> {
  return store.boards(game, dayOf(now));
}
