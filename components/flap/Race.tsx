"use client";

import { useEffect, useRef } from "react";
import { ROUND_MS } from "@/lib/arcade/room";
import { TICK_MS, type Bird } from "@/lib/flap/game";
import type { PlayProps } from "@/components/arcade/Versus";
import { BIRD_COLORS } from "./draw";
import { FlapCanvas, type Ghost, type GhostSample } from "./Game";

const LIVE_MS = 150;
const LIMIT = Math.floor(ROUND_MS.flap / TICK_MS);

const isSample = (value: unknown): value is GhostSample =>
  !!value && typeof value === "object" && ["k", "y", "s", "d"].every((key) => Number.isFinite((value as Record<string, unknown>)[key]));

/**
 * A round of a flappy bird race: everyone on the same pipes at once, the
 * others flying beside you as see-through birds, a moment behind where they
 * said they were. Where you've got to goes out a few times a second, and
 * your flaps go to the server when you're out.
 */
export function FlapRace({ round, me, names, playing, finished, client }: PlayProps) {
  const ghosts = useRef(new Map<string, Ghost>());
  const mine = useRef<Bird | null>(null);
  const out = useRef(false);
  const colors = new Map(round.players.map((id, i) => [id, BIRD_COLORS[i % BIRD_COLORS.length]]));

  const nameList = useRef(names);
  useEffect(() => {
    nameList.current = names;
  });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      const sentAt = performance.now();
      const bird = mine.current;
      const data = JSON.stringify(bird && playing ? { k: bird.tick, y: Math.round(bird.y * 10) / 10, s: bird.score, d: out.current ? 1 : 0 } : { k: -1, y: 0, s: 0, d: 1 });
      const heard = await client.live(data);
      if (stopped) return;
      for (const [id, entry] of Object.entries(heard ?? {})) {
        let sample: unknown;
        try {
          sample = JSON.parse(entry.data);
        } catch {
          continue;
        }
        if (!isSample(sample) || sample.k < 0 || !round.players.includes(id)) continue;
        const ghost = ghosts.current.get(id) ?? { name: nameList.current.get(id) ?? "someone", color: colors.get(id) ?? "#ffffff", samples: [] };
        const last = ghost.samples.at(-1);
        if (!last || sample.k > last.k || sample.d !== last.d) ghost.samples.push(sample);
        if (ghost.samples.length > 40) ghost.samples.splice(0, ghost.samples.length - 40);
        ghosts.current.set(id, ghost);
      }
      timer = setTimeout(() => void loop(), Math.max(50, LIVE_MS - (performance.now() - sentAt)));
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // Colours come from the round's players, which don't change within it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, playing, round.seed]);

  // A run that doesn't get through is tried again, a few times.
  const finish = async (flaps: number[]) => {
    for (let i = 0; i < 4; i++) {
      if (await client.finish(flaps)) return;
      await new Promise((resolve) => setTimeout(resolve, 800 * (i + 1)));
    }
  };

  return (
    <FlapCanvas
      key={round.seed}
      seed={round.seed}
      startAt={round.startAt}
      limit={LIMIT}
      color={colors.get(me)}
      ghosts={ghosts}
      watch={!playing || finished}
      onLive={(bird) => (mine.current = bird)}
      onOver={(run) => {
        out.current = true;
        void finish(run.flaps);
      }}
    />
  );
}
