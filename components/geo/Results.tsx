"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { countryName } from "@/lib/geo/countries";
import { MAX_POINTS, formatDistance, formatPoints } from "@/lib/geo/score";
import { formatCaptureDate, mapsUrl } from "@/lib/geo/streetview";
import type { Place } from "@/lib/geo/types";
import { ResultMap, type ResultRound } from "./Maps";

/**
 * The results screen: the map fills the screen and a card sits along the
 * bottom. The map keeps its pins clear of the card, however tall it grows.
 */
export function ResultsLayout({ rounds, children, label }: { rounds: ResultRound[]; children: ReactNode; label?: string }) {
  const card = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(260);

  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const measure = () => setCardHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="absolute inset-0 z-20 bg-paper">
      <div className="absolute inset-0">
        <ResultMap rounds={rounds} padding={[56, 48, cardHeight + 40, 48]} label={label} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <section
          ref={card}
          className="pointer-events-auto max-h-[62dvh] w-full max-w-[42rem] overflow-y-auto overscroll-contain rounded-2xl bg-paper p-5 text-[13.5px] text-ink shadow-[0_4px_24px_rgb(0_0_0/0.28)] max-sm:p-4"
        >
          {children}
        </section>
      </div>
    </div>
  );
}

/** How much of the round's 5,000 you got. */
export function PointsBar({ points, className = "" }: { points: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-faint/40 ${className}`} aria-hidden>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, (points / MAX_POINTS) * 100))}%` }}
      />
    </div>
  );
}

/** "It was in Japan · imagery from jun 2019 · see it on Google Maps". */
export function PlaceFacts({ place }: { place: Place }) {
  const country = countryName(place.country);
  const date = formatCaptureDate(place.date);
  return (
    <p className="text-muted">
      {country && (
        <>
          it was in <span className="text-ink">{country}</span>
        </>
      )}
      {date && <> · imagery from {date}</>} ·{" "}
      <a href={mapsUrl(place)} target="_blank" rel="noreferrer" className="underline decoration-faint underline-offset-2 hover:text-ink">
        see it on google maps
      </a>
    </p>
  );
}

/** Space or enter moves on, the same keys that guess, so a round can be played without the mouse. */
export function useAdvanceKey(onAdvance: (() => void) | null) {
  const latest = useRef(onAdvance);
  useEffect(() => {
    latest.current = onAdvance;
  });
  useEffect(() => {
    // Wait for the key that guessed to come back up, or it would skip the results too.
    let armed = false;
    const arm = () => (armed = true);
    const timer = setTimeout(arm, 400);
    const onKey = (event: KeyboardEvent) => {
      if (!armed || event.repeat || (event.key !== " " && event.key !== "Enter")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable]")) return;
      if (!latest.current) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

/** A round's distance and points, big. */
export function Verdict({ km, points }: { km: number | null; points: number }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <p className="text-[22px] font-semibold tracking-tight max-sm:text-[19px]">
        {km === null ? "no guess" : `${formatDistance(km)} away`}
      </p>
      <p className="text-[22px] font-semibold tabular-nums tracking-tight text-accent max-sm:text-[19px]">
        {formatPoints(points)} <span className="text-[14px] font-medium text-muted">points</span>
      </p>
    </div>
  );
}
