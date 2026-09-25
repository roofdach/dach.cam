"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MAP_BOUNDS, MAP_SCALES } from "@/lib/geo/data/scales";
import { countryName } from "@/lib/geo/countries";
import { dailyNumber, msUntilNextDaily, scoreSquare } from "@/lib/geo/daily";
import { haversineKm } from "@/lib/geo/earth";
import { MAP_BY_ID, isMapId, type MapId } from "@/lib/geo/maps";
import { MAX_POINTS, formatDistance, formatPoints, pointsFor } from "@/lib/geo/score";
import type { LatLng, Place } from "@/lib/geo/types";
import { Play } from "./Play";
import { PlaceFacts, PointsBar, ResultsLayout, Verdict, useAdvanceKey } from "./Results";
import { StreetView } from "./StreetView";
import { KEYS, forget, save } from "./storage";
import { Button, formatWait } from "./ui";
import { isPlace } from "@/lib/geo/room";

/** A game on your own, saved after every move so a refresh carries on where it was. */
export interface SoloGame {
  v: 1;
  kind: "solo" | "daily";
  /** The daily's date. */
  date?: string;
  map: MapId;
  /** Seconds per round, or null for no limit. */
  time: number | null;
  places: Place[];
  /** One per finished round; null where time ran out with no pin down. */
  guesses: (LatLng | null)[];
  round: number;
  phase: "playing" | "result" | "done";
  /** When the current round started, by this machine's clock. */
  startedAt: number;
  pin: LatLng | null;
}

const isLatLng = (value: unknown): value is LatLng =>
  !!value &&
  typeof value === "object" &&
  Number.isFinite((value as LatLng).lat) &&
  Number.isFinite((value as LatLng).lng) &&
  Math.abs((value as LatLng).lat) <= 90 &&
  Math.abs((value as LatLng).lng) <= 180;

/** Checks a saved game thoroughly: storage is only ever a suggestion. */
export function isSoloGame(value: unknown): value is SoloGame {
  if (!value || typeof value !== "object") return false;
  const g = value as Partial<SoloGame>;
  return (
    g.v === 1 &&
    (g.kind === "solo" || g.kind === "daily") &&
    (g.kind === "solo" || typeof g.date === "string") &&
    isMapId(g.map) &&
    (g.time === null || (typeof g.time === "number" && g.time > 0)) &&
    Array.isArray(g.places) &&
    g.places.length > 0 &&
    g.places.every(isPlace) &&
    Array.isArray(g.guesses) &&
    g.guesses.every((x) => x === null || isLatLng(x)) &&
    typeof g.round === "number" &&
    Number.isInteger(g.round) &&
    g.round >= 0 &&
    g.round < g.places.length &&
    (g.phase === "playing" || g.phase === "result" || g.phase === "done") &&
    (g.phase !== "done" || g.round === g.places.length - 1) &&
    g.guesses.length === g.round + (g.phase === "playing" ? 0 : 1) &&
    typeof g.startedAt === "number" &&
    (g.pin === null || isLatLng(g.pin))
  );
}

export function newSoloGame(kind: SoloGame["kind"], map: MapId, time: number | null, places: Place[], date?: string): SoloGame {
  return { v: 1, kind, date, map, time, places, guesses: [], round: 0, phase: "playing", startedAt: Date.now(), pin: null };
}

export interface Scored {
  km: number | null;
  points: number;
}

export function scoreGame(game: SoloGame): Scored[] {
  return game.guesses.map((guess, i) => {
    if (!guess) return { km: null, points: 0 };
    const place = game.places[i];
    const km = haversineKm(guess.lat, guess.lng, place.lat, place.lng);
    return { km, points: pointsFor(km, MAP_SCALES[game.map]) };
  });
}

export function shareText(game: SoloGame, host: string): string {
  const scores = scoreGame(game);
  const total = scores.reduce((sum, s) => sum + s.points, 0);
  const head = game.kind === "daily" && game.date ? `geo daily #${dailyNumber(game.date)}` : `geo · ${MAP_BY_ID[game.map].name}`;
  return `${head} · ${formatPoints(total)} / ${formatPoints(MAX_POINTS * game.places.length)}\n${scores.map((s) => scoreSquare(s.points)).join("")}\n${host}/geo`;
}

const storageKey = (game: SoloGame) => (game.kind === "daily" ? KEYS.daily : KEYS.solo);

export function Solo({
  initial,
  onExit,
  onAgain,
}: {
  initial: SoloGame;
  onExit: () => void;
  /** Play the same kind of game again; absent for the daily. */
  onAgain?: () => void;
}) {
  const [game, setGame] = useState(initial);
  const [reset, setReset] = useState(0);
  const map = MAP_BY_ID[game.map];

  const update = useCallback((next: (g: SoloGame) => SoloGame) => {
    setGame((current) => {
      const updated = next(current);
      if (updated !== current) save(storageKey(updated), updated);
      return updated;
    });
  }, []);

  const guess = useCallback(
    (pin: LatLng | null) =>
      update((g) => (g.phase !== "playing" ? g : { ...g, guesses: [...g.guesses, pin], phase: "result", pin: null })),
    [update],
  );

  const next = useCallback(() => {
    setReset(0);
    update((g) => {
      if (g.phase !== "result") return g;
      const round = g.round + 1;
      if (round >= g.places.length) return { ...g, phase: "done" };
      return { ...g, round, phase: "playing", startedAt: Date.now(), pin: null };
    });
  }, [update]);

  // Time's up: whatever pin is down is the guess.
  useEffect(() => {
    if (game.phase !== "playing" || game.time === null) return;
    const deadline = game.startedAt + game.time * 1000;
    const check = () => {
      if (Date.now() >= deadline) update((g) => (g.phase !== "playing" || g.startedAt !== game.startedAt ? g : { ...g, guesses: [...g.guesses, g.pin], phase: "result", pin: null }));
    };
    check();
    const timer = setInterval(check, 250);
    return () => clearInterval(timer);
  }, [game.phase, game.time, game.startedAt, update]);

  const scores = useMemo(() => scoreGame(game), [game]);
  const total = scores.reduce((sum, s) => sum + s.points, 0);
  const place = game.places[Math.min(game.round, game.places.length - 1)];
  // During results the next round's panorama loads out of sight.
  const shown = game.phase === "playing" ? place : game.phase === "result" ? game.places[game.round + 1] : undefined;

  useAdvanceKey(game.phase === "result" ? next : null);

  return (
    <div className="fixed inset-0 touch-manipulation overflow-hidden bg-[#2b2a27] text-ink">
      {shown && <StreetView key={shown.pano} pano={shown.pano} heading={shown.heading} visible={game.phase === "playing"} reset={reset} />}

      {game.phase === "playing" && (
        <Play
          mapName={map.name}
          bounds={MAP_BOUNDS[game.map]}
          round={game.round + 1}
          rounds={game.places.length}
          score={total}
          deadline={game.time === null ? null : game.startedAt + game.time * 1000}
          clock={Date.now}
          pin={game.pin}
          onPin={(pin) => update((g) => (g.phase === "playing" ? { ...g, pin } : g))}
          onGuess={() => game.pin && guess(game.pin)}
          guessed={false}
          onReset={() => setReset((r) => r + 1)}
          onLeave={onExit}
          leaveLabel="menu"
        />
      )}

      {game.phase === "result" && (
        <RoundResult game={game} scores={scores} onNext={next} onExit={onExit} />
      )}

      {game.phase === "done" && (
        <Summary game={game} scores={scores} onExit={onExit} onAgain={onAgain} />
      )}
    </div>
  );
}

function RoundResult({ game, scores, onNext, onExit }: { game: SoloGame; scores: Scored[]; onNext: () => void; onExit: () => void }) {
  const place = game.places[game.round];
  const guess = game.guesses[game.round];
  const score = scores[game.round];
  const last = game.round + 1 >= game.places.length;
  const rounds = [
    {
      answer: place,
      guesses: guess ? [{ ...guess, color: "#b7502f", label: "you", title: "Your guess", mine: true }] : [],
    },
  ];

  return (
    <ResultsLayout rounds={rounds} label="Map of where it was and your guess">
      <div className="flex items-center justify-between gap-3 text-muted">
        <h2>
          round {game.round + 1} of {game.places.length}
        </h2>
        <button type="button" onClick={onExit} className="hover:text-ink">
          menu
        </button>
      </div>
      <div role="status" className="mt-2">
        <Verdict km={score.km} points={score.points} />
        {score.km === null && <p className="mt-1 text-muted">time ran out before you put a pin down.</p>}
      </div>
      <PointsBar points={score.points} className="mt-3" />
      <div className="mt-3">
        <PlaceFacts place={place} />
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        <span className="text-[12px] text-muted max-sm:hidden">or press space</span>
        <Button tone="solid" onClick={onNext} autoFocus>
          {last ? "see how you did" : "next round"} <span aria-hidden>→</span>
        </Button>
      </div>
    </ResultsLayout>
  );
}

function Summary({ game, scores, onExit, onAgain }: { game: SoloGame; scores: Scored[]; onExit: () => void; onAgain?: () => void }) {
  const total = scores.reduce((sum, s) => sum + s.points, 0);
  const [copied, setCopied] = useState(false);
  const rounds = game.places.map((place, i) => ({
    answer: place,
    label: String(i + 1),
    guesses: game.guesses[i] ? [{ ...game.guesses[i]!, color: "#b7502f", label: String(i + 1), title: `Your guess in round ${i + 1}`, mine: true }] : [],
  }));

  const share = async () => {
    const text = shareText(game, window.location.host);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      window.prompt("Copy this:", text);
    }
  };

  return (
    <ResultsLayout rounds={rounds} label="Map of every round">
      <h2 className="text-muted">{game.kind === "daily" && game.date ? `daily #${dailyNumber(game.date)}` : `${MAP_BY_ID[game.map].name}, ${game.places.length} rounds`}</h2>
      <p role="status" className="mt-2 text-[24px] font-semibold tracking-tight">
        {formatPoints(total)} <span className="text-[15px] font-medium text-muted">of {formatPoints(MAX_POINTS * game.places.length)}</span>
      </p>
      <PointsBar points={total / game.places.length} className="mt-2" />
      <ol className="mt-4 divide-y divide-faint/40">
        {game.places.map((place, i) => (
          <li key={place.pano} className="flex items-baseline gap-3 py-1.5">
            <span className="w-5 text-muted tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{countryName(place.country) ?? "somewhere"}</span>
            <span className="text-muted tabular-nums">{scores[i].km === null ? "no guess" : formatDistance(scores[i].km!)}</span>
            <span className="w-16 text-right font-medium tabular-nums">{formatPoints(scores[i].points)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {game.kind === "daily" ? (
          <>
            <span className="mr-auto text-muted">next daily in {formatWait(msUntilNextDaily())}</span>
            <Button onClick={share}>{copied ? "copied" : "share"}</Button>
            <Button tone="solid" onClick={onExit} autoFocus>
              menu
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onExit}>menu</Button>
            {onAgain && (
              <Button tone="solid" onClick={onAgain} autoFocus>
                play again
              </Button>
            )}
          </>
        )}
      </div>
    </ResultsLayout>
  );
}

/** Forgets the saved solo game, so the menu stops offering to continue it. The daily is kept, to show today's score. */
export function clearSolo() {
  forget(KEYS.solo);
}
