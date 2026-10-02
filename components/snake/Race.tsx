"use client";

import { useEffect, useRef, useState } from "react";
import { ROUND_MS } from "@/lib/arcade/room";
import { COLS, ROWS, isDir, packBody, unpackBody, type Dir, type Snake } from "@/lib/snake/game";
import type { PlayProps } from "@/components/arcade/Versus";
import { SNAKE_COLORS, drawBoard } from "./draw";
import { SnakeCanvas } from "./Game";

const LIVE_MS = 200;

/** How someone else's board looks, as they last said. */
interface Seen {
  k: number;
  b: string;
  a: number;
  g: number;
  s: number;
  d: number;
  r: Dir;
}

const isSeen = (v: unknown): v is Seen => {
  const x = v as Record<string, unknown> | null;
  return !!x && typeof x.b === "string" && ["k", "a", "g", "s", "d"].every((key) => Number.isFinite(x[key])) && isDir(x.r);
};

/**
 * A round of a snake race: everyone on the same board with the same first
 * apple, at once, each on their own board. Yours is big; everyone else's
 * are small beside it, as they last said, a few times a second. Your turns
 * go to the server when you're out.
 */
export function SnakeRace({ round, me, names, playing, finished, client }: PlayProps) {
  const mine = useRef<Snake | null>(null);
  const out = useRef(false);
  const boards = useRef(new Map<string, Seen>());
  const minis = useRef(new Map<string, HTMLCanvasElement>());
  const [scores, setScores] = useState<Record<string, { s: number; d: number }>>({});
  const [diedHere, setDiedHere] = useState(false);
  const others = round.players.filter((id) => id !== me);
  const colors = new Map(round.players.map((id, i) => [id, SNAKE_COLORS[i % SNAKE_COLORS.length]]));

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      const sentAt = performance.now();
      const s = mine.current;
      const data = JSON.stringify(s && playing ? { k: s.step, b: packBody(s.body), a: s.apple, g: s.gold?.cell ?? -1, s: s.score, d: out.current ? 1 : 0, r: s.dir } : { k: -1, b: "", a: -1, g: -1, s: 0, d: 1, r: 1 });
      const heard = await client.live(data);
      if (stopped) return;
      const next: Record<string, { s: number; d: number }> = {};
      for (const [id, entry] of Object.entries(heard ?? {})) {
        let seen: unknown;
        try {
          seen = JSON.parse(entry.data);
        } catch {
          continue;
        }
        if (!isSeen(seen) || seen.k < 0 || !round.players.includes(id)) continue;
        const before = boards.current.get(id);
        if (!before || seen.k >= before.k) boards.current.set(id, seen);
      }
      for (const [id, seen] of boards.current) next[id] = { s: seen.s, d: seen.d };
      setScores((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      timer = setTimeout(() => void loop(), Math.max(50, LIVE_MS - (performance.now() - sentAt)));
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // Who's in the round doesn't change within it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, playing, round.seed]);

  // The little boards, drawn every frame from what was last heard.
  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      for (const [id, el] of minis.current) {
        const ctx = el.getContext("2d");
        const seen = boards.current.get(id);
        if (!ctx) continue;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = el.clientWidth;
        if (el.width !== Math.round(w * dpr)) {
          el.width = Math.round(w * dpr);
          el.height = Math.round(((w * ROWS) / COLS) * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBoard(ctx, { body: seen ? unpackBody(seen.b) : [], dir: seen?.r ?? 1, apple: seen?.a ?? -1, gold: seen?.g ?? -1, dead: !!seen?.d, color: colors.get(id) }, w / COLS, t);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // Colours come from the round's players, which don't change within it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.seed]);

  const finish = async (turns: [number, Dir][]) => {
    for (let i = 0; i < 4; i++) {
      if (await client.finish(turns)) return;
      await new Promise((resolve) => setTimeout(resolve, 800 * (i + 1)));
    }
  };

  return (
    <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_13rem]">
      <SnakeCanvas
        key={round.seed}
        seed={round.seed}
        startAt={round.startAt}
        limitMs={ROUND_MS.snake}
        color={colors.get(me)}
        watch={!playing || (finished && !diedHere)}
        onLive={(s) => (mine.current = s)}
        onOver={(run) => {
          out.current = true;
          setDiedHere(true);
          void finish(run.turns);
        }}
      />
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-1">
        {others.map((id) => (
          <li key={id} className="overflow-hidden rounded-lg border border-faint/70">
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-[12.5px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: colors.get(id) }} />
                <span className="truncate font-medium">{names.get(id) ?? "someone"}</span>
              </span>
              <span className="font-mono tabular-nums">
                {scores[id]?.s ?? 0}
                {scores[id]?.d ? " ✗" : ""}
              </span>
            </div>
            <canvas
              ref={(el) => {
                if (el) minis.current.set(id, el);
                else minis.current.delete(id);
              }}
              className="block w-full"
              style={{ aspectRatio: `${COLS} / ${ROWS}` }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
