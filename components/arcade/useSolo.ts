"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { randomId } from "@/lib/random";
import type { ArcadeGame } from "@/lib/arcade/games";
import type { Boards, Standing } from "@/lib/arcade/scores";
import type { Ticket } from "@/lib/arcade/server/scores";
import { KEYS, isString, load, save } from "@/components/game/storage";
import { fetchBoards, fetchTicket, loadBest, saveBest, submitRun, whoAmI } from "./scores-client";

/**
 * Playing an arcade game alone, one run after another: a ticket for each
 * run (its course, and proof of when it started), your best on this
 * device, and each run sent to the boards as it ends. Without the boards
 * (offline, or no database here) the runs still play, and still count
 * towards your best here.
 */

export interface SoloResult {
  score: number;
  /** A new best on this device. */
  record: boolean;
  standing: Standing | null;
  sending: boolean;
  /** Waiting for a name before it can go on the board. */
  needsName: boolean;
  error: string | null;
}

export function useSolo(game: ArcadeGame) {
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined);
  const [run, setRun] = useState(0);
  const [best, setBest] = useState(() => loadBest(game));
  const [boards, setBoards] = useState<Boards | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [result, setResult] = useState<SoloResult | null>(null);
  const [offlineSeed, setOfflineSeed] = useState(() => randomId(12));
  const next = useRef<Promise<Ticket | null> | null>(null);
  const waiting = useRef<{ ticket: Ticket; moves: unknown } | null>(null);

  useEffect(() => {
    let live = true;
    void whoAmI().then((who) => live && setMe(who));
    void fetchBoards(game).then((found) => {
      if (!live) return;
      if (found) setBoards(found);
      else setUnavailable(true);
    });
    void fetchTicket(game).then((t) => live && setTicket(t));
    return () => {
      live = false;
    };
  }, [game]);

  const send = useCallback(
    async (used: Ticket, moves: unknown, name: string) => {
      setResult((r) => r && { ...r, sending: true, needsName: false, error: null });
      const sent = await submitRun(game, used, moves, name);
      if ("error" in sent) return setResult((r) => r && { ...r, sending: false, error: sent.error });
      setBoards(sent.boards);
      setMe(sent.who);
      setResult((r) => r && { ...r, sending: false, standing: sent.standing });
    },
    [game],
  );

  /** A run's over: keep the best, and send it to the boards if it can go. */
  const over = useCallback(
    (moves: unknown, score: number) => {
      const record = score > best;
      if (record) {
        setBest(score);
        saveBest(game, score);
      }
      const used = ticket;
      next.current = fetchTicket(game);
      const name = load(KEYS.name, isString);
      const counts = !!used && score > 0;
      setResult({ score, record, standing: null, sending: counts && !!name, needsName: counts && !name, error: null });
      // A run that isn't sent still brings the boards up to date.
      if (!counts || !name) void fetchBoards(game).then((found) => found && setBoards(found));
      if (!counts) return;
      if (name) void send(used!, moves, name);
      else waiting.current = { ticket: used!, moves };
    },
    [best, game, send, ticket],
  );

  /** A name for a run that ended without one. */
  const nameAndSend = useCallback(
    (name: string) => {
      const run = waiting.current;
      if (!run || !name.trim()) return;
      save(KEYS.name, name.trim());
      waiting.current = null;
      void send(run.ticket, run.moves, name.trim());
    },
    [send],
  );

  /** Another go, on a fresh ticket. */
  const again = useCallback(async () => {
    setResult(null);
    setTicket(undefined);
    const fresh = await (next.current ?? fetchTicket(game));
    next.current = null;
    setOfflineSeed(randomId(12));
    setTicket(fresh);
    setRun((n) => n + 1);
  }, [game]);

  const seed = ticket === undefined ? null : (ticket?.seed ?? offlineSeed);
  return { seed, counts: !!ticket, run, best, boards, unavailable, me, result, over, again, nameAndSend };
}
