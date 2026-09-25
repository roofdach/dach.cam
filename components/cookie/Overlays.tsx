"use client";

import { useEffect, useRef, useState } from "react";
import { ACHIEVEMENT_BY_ID } from "@/lib/cookie/achievements";
import { BUILDINGS } from "@/lib/cookie/buildings";
import type { Notice } from "@/lib/cookie/engine";
import { formatDuration } from "@/lib/cookie/format";
import { useCookieGame, useFormat, useGame } from "./context";
import { CookieArt } from "./CookieArt";
import styles from "./cookie.module.css";
import { BUILDING_SPECIALS, Modal, times } from "./ui";

/* ---------------------------------------------------------------- golden */

export function GoldenCookie() {
  const showing = useGame((state) => state.run.golden !== null && !state.legacy.ascending);
  return (
    <>
      {/* Said once when one appears, for anyone who can't see it. */}
      <p role="status" className="sr-only">
        {showing ? "A golden cookie has appeared." : ""}
      </p>
      {showing && <Golden />}
    </>
  );
}

function Golden() {
  const game = useCookieGame();
  const x = useGame((state) => state.run.golden?.x ?? 0.5);
  const y = useGame((state) => state.run.golden?.y ?? 0.5);
  const age = useGame((state) => state.run.golden?.age ?? 0);
  const life = useGame((state) => state.run.golden?.life ?? 13);
  // Fades in over the first moment and out over the last second and a half.
  const opacity = Math.max(0.15, Math.min(1, age / 0.6, (life - age) / 1.5));
  return (
    <button
      type="button"
      aria-label="Golden cookie"
      className={`size-16 sm:size-20 ${styles.golden}`}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, opacity }}
      onClick={() => game.clickGolden()}
    >
      <CookieArt variant="golden" className="size-full" />
    </button>
  );
}

/* ---------------------------------------------------------------- toasts */

interface Toast {
  id: number;
  title: string;
  body: string;
  tone: "achievement" | "golden" | "info";
}

const seconds = (value: number) => formatDuration(Math.round(value));

export function Toasts() {
  const game = useCookieGame();
  const format = useFormat();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<number>());
  // The notice listener outlives renders; this keeps its formatting current.
  const formatRef = useRef(format);
  useEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    const live = timers.current;
    const unsubscribe = game.onNotices((notices) => {
      const made = toastsFor(notices, formatRef.current, () => nextId.current++);
      if (made.length === 0) return;
      setToasts((current) => [...current, ...made].slice(-4));
      for (const toast of made) {
        const timer = window.setTimeout(
          () => {
            live.delete(timer);
            setToasts((current) => current.filter((t) => t.id !== toast.id));
          },
          toast.tone === "info" ? 9000 : 5500,
        );
        live.add(timer);
      }
    });
    return () => {
      unsubscribe();
      for (const timer of live) window.clearTimeout(timer);
      live.clear();
    };
  }, [game]);

  // Toasts can land on the cookie, so clicks go straight through them: a fast
  // clicker should never lose a click to a notification. They go on their own.
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex flex-col items-center gap-2 px-3"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`w-full max-w-sm rounded-xl border px-4 py-2.5 shadow-lg backdrop-blur ${styles.enter} ${
            toast.tone === "golden"
              ? "border-amber-400/60 bg-amber-50/95 dark:bg-amber-950/90"
              : "border-faint/60 bg-paper/95"
          }`}
        >
          <p className="text-[13.5px] font-medium text-ink">{toast.title}</p>
          <p className="text-[12.5px] leading-snug text-muted">{toast.body}</p>
        </div>
      ))}
    </div>
  );
}

/** One toast per thing that happened, except that a burst of achievements shares one. */
function toastsFor(notices: Notice[], format: (value: number) => string, nextId: () => number): Toast[] {
  const achievements = notices.flatMap((n) => (n.kind === "achievement" ? [ACHIEVEMENT_BY_ID.get(n.id)] : []));
  const names = achievements.flatMap((a) => (a ? [a.name] : []));
  const toasts = notices
    .filter((n) => n.kind !== "achievement" || names.length <= 2)
    .map((n) => describe(n, format, nextId()))
    .filter((t): t is Toast => t !== null);
  if (names.length > 2) {
    const listed = names.length > 5 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
    toasts.push({ id: nextId(), tone: "achievement", title: `🏆 ${names.length} achievements`, body: `${listed}.` });
  }
  return toasts;
}

function describe(notice: Notice, format: (value: number) => string, id: number): Toast | null {
  if (notice.kind === "achievement") {
    const achievement = ACHIEVEMENT_BY_ID.get(notice.id);
    if (!achievement) return null;
    return { id, tone: "achievement", title: `🏆 ${achievement.name}`, body: achievement.desc };
  }
  if (notice.kind === "offline") {
    return {
      id,
      tone: "info",
      title: "Welcome back",
      body: `The oven was left on: ${format(notice.amount)} cookies baked while you were away for ${formatDuration(notice.seconds)}.`,
    };
  }
  switch (notice.effect) {
    case "lucky":
      return { id, tone: "golden", title: "Lucky!", body: `+${format(notice.amount ?? 0)} cookies.` };
    case "frenzy":
      return {
        id,
        tone: "golden",
        title: "Frenzy!",
        body: `Cookie production ${times(notice.multiplier ?? 7)} for ${seconds(notice.seconds ?? 0)}.`,
      };
    case "click-frenzy":
      return {
        id,
        tone: "golden",
        title: "Click frenzy!",
        body: `Every click is worth ${times(notice.multiplier ?? 777)} for ${seconds(notice.seconds ?? 0)}.`,
      };
    case "building": {
      const building = notice.building ?? 0;
      return {
        id,
        tone: "golden",
        title: `${BUILDING_SPECIALS[building]}!`,
        body: `Your ${BUILDINGS[building].plural} push production ${times(notice.multiplier ?? 1)} for ${seconds(notice.seconds ?? 0)}.`,
      };
    }
  }
}

/* ------------------------------------------------------------- elsewhere */

export function Elsewhere() {
  const game = useCookieGame();
  const elsewhere = useGame((_, g) => g.status === "elsewhere");
  if (!elsewhere) return null;
  return (
    <Modal labelledBy="elsewhere-title">
      <h2 id="elsewhere-title" className="text-[17px] font-semibold">
        Playing in another tab
      </h2>
      <p className="mt-2 text-[14px] text-muted">
        The game is open somewhere else, so this tab has paused to keep the two from overwriting each other&rsquo;s
        progress.
      </p>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          autoFocus
          onClick={() => game.takeOver()}
          className="rounded-lg bg-ink px-4 py-2 text-[14px] font-medium text-paper hover:opacity-85"
        >
          Play here instead
        </button>
      </div>
    </Modal>
  );
}
