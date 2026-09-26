"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatPoints } from "@/lib/geo/score";
import type { LatLng } from "@/lib/geo/types";
import { GuessMap, type Bounds } from "./Maps";
import { DESKTOP, Float, formatClock, useMedia } from "@/components/game/ui";

/**
 * Everything drawn over Street View while a round is on: what map and round
 * this is, the clock, a way out, a way back to the start, and the map to
 * guess on. On a laptop the map sits in the corner and grows under the
 * mouse; on a phone it gets the whole screen when you ask for it.
 */
export function Play({
  mapName,
  bounds,
  round,
  rounds,
  score,
  deadline,
  limit,
  clock,
  pin,
  onPin,
  onGuess,
  guessed,
  waiting,
  onReset,
  onLeave,
  leaveLabel = "leave",
  side,
}: {
  mapName: string;
  bounds: Bounds;
  /** 1-based. */
  round: number;
  rounds: number;
  score: number;
  /** When the round ends, on `clock`; null for no limit. */
  deadline: number | null;
  /** The round's full length, so the clock doesn't show more than that before the round starts. */
  limit?: number;
  clock: () => number;
  pin: LatLng | null;
  onPin: (point: LatLng) => void;
  onGuess: () => void;
  /** Already guessed and waiting on others. */
  guessed: boolean;
  /** Shown in place of the guess button once you've guessed. */
  waiting?: string;
  onReset: () => void;
  onLeave: () => void;
  leaveLabel?: string;
  /** Extra things for the top-left corner, like who has guessed. */
  side?: ReactNode;
}) {
  const desktop = useMedia(DESKTOP, true);
  const [open, setOpen] = useState(false);
  const [large, setLarge] = useState(false);
  const canGuess = pin !== null && !guessed;
  const latest = useRef({ canGuess, onGuess });

  useEffect(() => {
    latest.current = { canGuess, onGuess };
  });

  // Space or enter guesses, as long as you're not typing or on a button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable]")) return;
      if (!latest.current.canGuess) return;
      event.preventDefault();
      latest.current.onGuess();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const guessButton = (
    <button
      type="button"
      onClick={onGuess}
      disabled={!canGuess}
      className="min-h-11 w-full rounded-lg bg-ink px-4 text-[14px] font-semibold text-paper shadow-[0_1px_6px_rgb(0_0_0/0.3)] transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:bg-[#3d3b37] disabled:text-[#d8d4ca]"
    >
      {guessed ? (waiting ?? "guessed") : pin ? "guess" : "place your pin on the map"}
    </button>
  );

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto flex min-w-0 flex-col items-start gap-2">
          <Float onClick={onLeave}>
            <span aria-hidden>←</span> {leaveLabel}
          </Float>
          {side}
        </div>
        <Hud mapName={mapName} round={round} rounds={rounds} score={score} deadline={deadline} limit={limit} clock={clock} />
      </div>

      <Float onClick={onReset} className="absolute bottom-10 left-3" title="Back to where the round started">
        <span aria-hidden>↺</span> back to start
      </Float>

      {desktop ? (
        <div className="absolute bottom-10 right-3 flex flex-col items-stretch gap-2">
          <div
            data-large={large || undefined}
            className="group relative h-[190px] w-[280px] overflow-hidden rounded-xl shadow-[0_2px_12px_rgb(0_0_0/0.35)] transition-[width,height] delay-300 duration-200 hover:h-[min(440px,62vh)] hover:w-[min(640px,55vw)] hover:delay-0 focus-within:h-[min(440px,62vh)] focus-within:w-[min(640px,55vw)] data-large:h-[min(440px,62vh)] data-large:w-[min(640px,55vw)]"
          >
            <GuessMap bounds={bounds} pin={pin} onPin={onPin} disabled={guessed} />
            <button
              type="button"
              onClick={() => setLarge((l) => !l)}
              aria-pressed={large}
              title={large ? "Let the map shrink" : "Keep the map large"}
              className="absolute right-2 top-2 z-[1001] grid size-7 place-items-center rounded-md bg-white/90 text-[14px] text-[#1b1a17] shadow opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100"
            >
              <span aria-hidden>{large ? "↘" : "↖"}</span>
            </button>
          </div>
          {guessButton}
        </div>
      ) : open ? (
        <div className="absolute inset-0 z-10 flex flex-col bg-paper">
          <div className="min-h-0 flex-1">
            <GuessMap bounds={bounds} pin={pin} onPin={onPin} disabled={guessed} />
          </div>
          <div className="flex gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-lg border border-faint px-4 text-[14px] font-medium text-ink"
            >
              back to street view
            </button>
            <div className="flex-1">{guessButton}</div>
          </div>
        </div>
      ) : (
        <div className="absolute bottom-10 right-3 flex flex-col items-end gap-2">
          <Float onClick={() => setOpen(true)} className="min-h-11 px-4 text-[14px]">
            {guessed ? (waiting ?? "guessed") : pin ? "map · ready to guess" : "open the map to guess"}
          </Float>
        </div>
      )}
    </>
  );
}

function Hud({
  mapName,
  round,
  rounds,
  score,
  deadline,
  limit,
  clock,
}: {
  mapName: string;
  round: number;
  rounds: number;
  score: number;
  deadline: number | null;
  limit?: number;
  clock: () => number;
}) {
  return (
    <dl className="pointer-events-auto flex shrink-0 gap-4 rounded-xl bg-paper/92 px-4 py-2 text-ink shadow-[0_1px_6px_rgb(0_0_0/0.25)] backdrop-blur max-sm:gap-3 max-sm:px-3">
      <Stat label="map" className="max-sm:hidden">
        {mapName}
      </Stat>
      <Stat label="round">
        {round} / {rounds}
      </Stat>
      <Stat label="score">{formatPoints(score)}</Stat>
      {deadline !== null && (
        <Stat label="time">
          <Countdown deadline={deadline} limit={limit} clock={clock} />
        </Stat>
      )}
    </dl>
  );
}

function Stat({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col ${className}`}>
      <dt className="text-[11px] leading-4 text-muted">{label}</dt>
      <dd className="text-[14px] font-semibold leading-5 tabular-nums">{children}</dd>
    </div>
  );
}

/** Time left, ticking four times a second; red for the last ten. */
export function Countdown({ deadline, limit = Infinity, clock }: { deadline: number; limit?: number; clock: () => number }) {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 250);
    return () => clearInterval(timer);
  }, [clock]);
  const left = Math.min(limit, deadline - now);
  return <span className={left <= 10_000 ? "text-accent" : undefined}>{formatClock(left)}</span>;
}
