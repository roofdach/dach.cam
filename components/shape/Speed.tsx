"use client";

import { useEffect, useRef, useState } from "react";
import { BY_CODE, TARGETS, pickTargets, type Country } from "@/lib/shape/game";
import { useLocalNow } from "@/components/game/clock";
import { KEYS, load, save } from "@/components/game/storage";
import { Button, plural } from "@/components/game/ui";
import { CountryInput, Frame, Outline, ShareButton } from "./parts";

/**
 * Speed: name as many outlines as you can in a minute. A wrong name just
 * shakes; skip one if you're stuck. At the end, every shape you saw with its
 * name, and your best to beat.
 */

const SECONDS = 60;

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

interface Seen {
  code: string;
  got: boolean;
}

export function Speed() {
  const [phase, setPhase] = useState<"ready" | "playing" | "done">("ready");
  const [order, setOrder] = useState<Country[]>([]);
  const [seen, setSeen] = useState<Seen[]>([]);
  const [ends, setEnds] = useState(0);
  const [miss, setMiss] = useState<{ name: string; at: number } | null>(null);
  const [best, setBest] = useState(() => load(KEYS.shapeSpeed, isNumber) ?? 0);
  const [previousBest, setPreviousBest] = useState(best);
  const score = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const now = useLocalNow(200);

  const current = order[seen.length];
  const got = seen.filter((s) => s.got).length;

  const start = () => {
    setOrder(pickTargets(`speed:${Math.random()}`, TARGETS.length));
    setSeen([]);
    setMiss(null);
    score.current = 0;
    setPreviousBest(best);
    setEnds(Date.now() + SECONDS * 1000);
    setPhase("playing");
  };

  // Time's up: the best so far is saved as the minute ends.
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = setInterval(() => {
      if (Date.now() < ends) return;
      setPhase("done");
      setBest((b) => {
        const next = Math.max(b, score.current);
        save(KEYS.shapeSpeed, next);
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [phase, ends]);

  const guess = (country: Country) => {
    if (phase !== "playing" || !current) return;
    if (country.code === current.code) {
      score.current++;
      setSeen((s) => [...s, { code: current.code, got: true }]);
      setMiss(null);
    } else {
      setMiss({ name: country.name, at: Date.now() });
      // A shake says no, without moving focus from the box.
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        box.current?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-7px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }], { duration: 280 });
      }
    }
  };

  const skip = () => {
    if (phase !== "playing" || !current) return;
    setSeen((s) => [...s, { code: current.code, got: false }]);
    setMiss(null);
  };

  const left = Math.max(0, Math.ceil((ends - now) / 1000));

  if (phase === "ready") {
    return (
      <Frame title="speed">
        <div className="rounded-2xl border border-faint/70 p-6 text-center">
          <p className="text-[20px] font-semibold tracking-tight">how many can you name in a minute?</p>
          <p className="mt-2 text-muted">outlines come one after another. type the country; a wrong one costs nothing but time. stuck? skip it.</p>
          {best > 0 && <p className="mt-3 text-[13px] text-muted">your best: {best}</p>}
          <Button tone="solid" onClick={start} className="mt-5 min-h-11 px-6">
            start
          </Button>
        </div>
      </Frame>
    );
  }

  if (phase === "done") {
    const record = got > previousBest;
    return (
      <Frame title="speed">
        <div className="animate-fade-in rounded-2xl border border-faint/70 p-5 text-center">
          <p className="text-[13px] text-muted">time&rsquo;s up</p>
          <p className="mt-1 text-[26px] font-semibold tracking-tight">you named {plural(got, "country", "countries")}</p>
          <p className="mt-1 text-[13px] text-muted">{record ? "a new best!" : `your best: ${best}`}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button tone="solid" onClick={start} className="min-h-10 px-5">
              again
            </Button>
            <ShareButton text={`shape speed: ${got} in ${SECONDS}s 🏁\n${window.location.host}/shape`} label="share your score" />
          </div>
        </div>
        {seen.length > 0 && (
          <ul className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {seen.map((s, i) => {
              const country = BY_CODE.get(s.code)!;
              return (
                <li key={`${s.code}-${i}`} className={`rounded-lg p-2 text-center text-[12px] ${s.got ? "bg-[#d3f9d8] text-[#2b8a3e] dark:bg-[#1f3d25] dark:text-[#8ce99a]" : "bg-ink/[0.045] text-muted"}`}>
                  <Outline shape={country} className="mx-auto h-12 w-full text-current" label={country.name} />
                  <span className="mt-1 block truncate">{country.name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Frame>
    );
  }

  return (
    <Frame title="speed" right={<span className={`font-mono text-[18px] font-semibold tabular-nums ${left <= 10 ? "text-accent" : ""}`}>{left}s</span>}>
      <div className="flex items-baseline justify-between text-[13px] text-muted">
        <span>
          named <span className="font-semibold text-ink">{got}</span>
        </span>
        <span>{seen.length - got > 0 ? `skipped ${seen.length - got}` : ""}</span>
      </div>
      <div className="mt-2 grid place-items-center rounded-2xl bg-ink/[0.035] p-4">
        {current && <Outline key={`${current.code}-${seen.length}`} shape={current} className="h-[min(38vh,320px)] w-full text-ink animate-fade-in" />}
      </div>
      <div ref={box} className="mt-4">
        <CountryInput onGuess={guess} placeholder="which country is this?" action="go" />
      </div>
      <div className="mt-2 flex items-center justify-between text-[13px]">
        <span className="text-accent" role="status">
          {miss ? `not ${miss.name}` : ""}
        </span>
        <Button tone="quiet" onClick={skip}>
          skip
        </Button>
      </div>
    </Frame>
  );
}
