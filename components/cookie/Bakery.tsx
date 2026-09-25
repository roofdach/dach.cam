"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BUILDINGS } from "@/lib/cookie/buildings";
import * as engine from "@/lib/cookie/engine";
import type { BuffKind, GameState } from "@/lib/cookie/engine";
import { formatClock } from "@/lib/cookie/format";
import { pickHeadline } from "@/lib/cookie/news";
import { useCookieGame, useFormat, useGame } from "./context";
import { CookieArt } from "./CookieArt";
import styles from "./cookie.module.css";
import { BUILDING_SPECIALS, milkFlavour, times, useReducedMotion } from "./ui";

/** The left of the screen: the news, the count, the cookie, the milk. */
export function Bakery() {
  const effects = useGame((state) => state.settings.effects);
  return (
    <section
      aria-label="Bakery"
      className={`relative flex min-h-0 flex-col items-center overflow-clip select-none ${effects ? "" : styles.still}`}
    >
      <News />
      <Counter />
      <Buffs />
      <BigCookie />
      <Milk />
    </section>
  );
}

/* ------------------------------------------------------------------ news */

const newsContext = (state: GameState) => ({
  bakedAllTime: engine.bakedAllTime(state),
  owned: state.run.owned,
  goldenClicks: state.totals.goldenClicks,
  ascensions: state.legacy.ascensions,
});

function News() {
  const game = useCookieGame();
  const [headline, setHeadline] = useState(() => pickHeadline(newsContext(game.state), Math.random));
  const next = useCallback(
    () => setHeadline((current) => pickHeadline(newsContext(game.state), Math.random, current)),
    [game],
  );

  useEffect(() => {
    const timer = window.setInterval(next, 9000);
    return () => window.clearInterval(timer);
  }, [next]);

  return (
    <button
      type="button"
      onClick={() => {
        game.clickNews();
        next();
      }}
      className="relative z-10 w-full shrink-0 border-b border-faint/40 px-4 py-2 text-left text-[12.5px] leading-snug text-muted transition-colors hover:text-ink"
    >
      <span className="line-clamp-2 md:line-clamp-none">
        <span className="mr-2 font-medium text-ink">News</span>
        <span key={headline} className={styles.fade}>
          {headline}
        </span>
      </span>
    </button>
  );
}

/* --------------------------------------------------------------- counter */

function Counter() {
  const format = useFormat();
  const cookies = useGame((state) => Math.floor(state.run.cookies));
  const perSecond = useGame((_, game) => game.production().total);
  return (
    <div className="relative z-10 shrink-0 px-4 pt-4 text-center">
      <p className="text-[28px] font-semibold leading-tight tracking-tight tabular-nums sm:text-[34px]">
        {format(cookies)}{" "}
        <span className="text-[0.55em] font-medium text-muted">{cookies === 1 ? "cookie" : "cookies"}</span>
      </p>
      <p className="text-[13px] text-muted tabular-nums">per second: {format(perSecond, { decimal: true })}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- buffs */

function Buffs() {
  const list = useGame((state) => state.run.buffs.map((buff) => `${buff.kind}:${buff.building}`).join(" "));
  if (!list) return null;
  return (
    <ul aria-label="Boosts" className="relative z-10 mt-2 flex max-w-full flex-wrap justify-center gap-1.5 px-4">
      {list.split(" ").map((key) => {
        const [kind, building] = key.split(":");
        return <Buff key={key} kind={kind as BuffKind} building={Number(building)} />;
      })}
    </ul>
  );
}

function Buff({ kind, building }: { kind: BuffKind; building: number }) {
  const find = (state: GameState) => state.run.buffs.find((b) => b.kind === kind && b.building === building);
  const left = useGame((state) => find(state)?.left ?? 0);
  const total = useGame((state) => find(state)?.total ?? 1);
  const multiplier = useGame((state) => {
    const buff = find(state);
    return buff ? (kind === "click-frenzy" ? buff.click : buff.cps) : 1;
  });
  const name = kind === "frenzy" ? "Frenzy" : kind === "click-frenzy" ? "Click frenzy" : BUILDING_SPECIALS[building];
  const what = kind === "click-frenzy" ? "clicks" : kind === "building" ? `thanks to ${BUILDINGS[building].plural}` : "production";
  return (
    <li className="relative overflow-hidden rounded-full border border-amber-500/40 bg-amber-100/60 px-3 py-1 text-[12px] text-ink dark:bg-amber-400/10">
      <span className="font-medium">{name}</span>{" "}
      <span className="text-muted">
        {kind === "building" ? `production ${times(multiplier)} ${what}` : `${what} ${times(multiplier)}`}
      </span>{" "}
      <span className="tabular-nums">{formatClock(left)}</span>
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-amber-500/70"
        style={{ transform: `scaleX(${Math.max(0, Math.min(1, left / total))})` }}
      />
    </li>
  );
}

/* ---------------------------------------------------------------- cookie */

interface Bit {
  id: number;
  kind: "number" | "crumb";
  x: number;
  y: number;
  text?: string;
  dx?: number;
  dy?: number;
}

/** A few dozen are plenty; past that, the oldest go first. */
const MAX_BITS = 40;

function BigCookie() {
  const game = useCookieGame();
  const format = useFormat();
  const effects = useGame((state) => state.settings.effects);
  const reduce = useReducedMotion();
  const area = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const [bits, setBits] = useState<Bit[]>([]);

  const bake = (x: number, y: number) => {
    const value = game.click();
    if (!(value > 0) || !effects || reduce) return;
    // A little spread, so a run of clicks on one spot doesn't stack into a single blur.
    const made: Bit[] = [
      { id: nextId.current++, kind: "number", x: x + (Math.random() * 2 - 1) * 14, y, text: `+${format(value, { decimal: true })}` },
    ];
    for (let i = 0; i < 3; i++) {
      made.push({
        id: nextId.current++,
        kind: "crumb",
        x,
        y,
        dx: (Math.random() * 2 - 1) * 70,
        dy: -25 - Math.random() * 45,
      });
    }
    setBits((current) => [...current, ...made].slice(-MAX_BITS));
  };

  const centre = () => {
    const rect = area.current?.getBoundingClientRect();
    return rect ? [rect.width / 2, rect.height / 2] : [0, 0];
  };

  return (
    <div
      ref={area}
      className="relative flex min-h-0 w-full flex-1 items-center justify-center pt-2 pb-6 [container-type:size] md:pb-12"
    >
      <div aria-hidden className={styles.rays} />
      <button
        type="button"
        aria-label="Bake a cookie"
        // Sized by the room it actually has, so it never runs into the count or the milk.
        className={`relative z-10 size-[min(88cqh,80cqw,340px)] ${styles.cookie}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const rect = area.current!.getBoundingClientRect();
          bake(event.clientX - rect.left, event.clientY - rect.top);
        }}
        onClick={(event) => {
          // A keyboard or a screen reader clicks without a pointer behind it.
          if (event.detail === 0) bake(...(centre() as [number, number]));
        }}
        onKeyDown={(event) => {
          // Holding a key down isn't clicking.
          if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <CookieArt className="size-full" />
      </button>
      {bits.map((bit) =>
        bit.kind === "number" ? (
          <span
            key={bit.id}
            aria-hidden
            className={`z-20 text-[15px] text-ink ${styles.float}`}
            style={{ left: bit.x, top: bit.y }}
            onAnimationEnd={() => setBits((current) => current.filter((b) => b.id !== bit.id))}
          >
            {bit.text}
          </span>
        ) : (
          <span
            key={bit.id}
            aria-hidden
            className={`z-20 ${styles.crumb}`}
            style={{ left: bit.x, top: bit.y, ["--dx" as string]: `${bit.dx}px`, ["--dy" as string]: `${bit.dy}px` }}
            onAnimationEnd={() => setBits((current) => current.filter((b) => b.id !== bit.id))}
          />
        ),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ milk */

function Milk() {
  const milk = useGame((state) => engine.milk(state));
  if (!(milk > 0)) return null;
  const { color } = milkFlavour(milk);
  // From a splash to about a fifth of the panel as the glass fills.
  const height = 5 + Math.min(milk / 6, 1) * 15;
  return (
    <div aria-hidden className={`dark:opacity-85 ${styles.milk}`} style={{ height: `${height}%`, color }}>
      <div className="absolute inset-0 bg-current opacity-95" />
      <svg className={styles.wave} viewBox="0 0 200 12" preserveAspectRatio="none">
        <path d="M0 6 Q25 0 50 6 T100 6 T150 6 T200 6 V12 H0 Z" fill="currentColor" opacity="0.95" />
        {/* A faint line along the top, so plain milk still reads against a pale page. */}
        <path
          d="M0 6 Q25 0 50 6 T100 6 T150 6 T200 6"
          fill="none"
          stroke="rgb(0 0 0 / 0.12)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
