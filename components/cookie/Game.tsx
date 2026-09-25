"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { ACHIEVEMENTS } from "@/lib/cookie/achievements";
import * as engine from "@/lib/cookie/engine";
import { Bakery } from "./Bakery";
import { GameContext, useGame } from "./context";
import { Elsewhere, GoldenCookie, Toasts } from "./Overlays";
import { Achievements, Heaven, Legacy, Options, Stats } from "./Panels";
import { CookieGame } from "./runtime";
import { Shop } from "./Shop";

/** The whole game. Only ever rendered in the browser, where the save lives. */
export default function Game() {
  const [game] = useState(() => new CookieGame());

  useEffect(() => {
    game.start();
    return () => game.stop();
  }, [game]);

  return (
    <GameContext value={game}>
      <Root>
        <Header />
        <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,44fr)_minmax(0,56fr)] md:grid-cols-[minmax(0,1fr)_minmax(22rem,27rem)] md:grid-rows-1">
          <Bakery />
          <Side />
        </main>
        <GoldenCookie />
        <Toasts />
        <Ascended />
        <Elsewhere />
      </Root>
    </GameContext>
  );
}

function Root({ children }: { children: ReactNode }) {
  // Whether this tab is the one playing, for anything that needs to know from outside.
  const status = useGame((_, game) => game.status);
  return (
    // No double-tap zoom anywhere in the game: a fast second tap is a second click.
    <div data-game={status} className="flex h-dvh touch-manipulation flex-col overflow-clip">
      {children}
    </div>
  );
}

function Header() {
  const canSave = useGame((_, game) => game.canSave);
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-faint/40 px-4 text-[13.5px]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2">
        <Link href="/" className="text-muted transition-colors hover:text-ink">
          dach
        </Link>
        <span aria-hidden className="text-faint">
          /
        </span>
        <h1 className="font-medium text-ink">cookie</h1>
      </nav>
      {!canSave && <p className="text-[12.5px] text-accent">This browser isn&rsquo;t letting the game save.</p>}
    </header>
  );
}

function Ascended() {
  const ascending = useGame((state) => state.legacy.ascending);
  const playing = useGame((_, game) => game.status === "playing");
  return ascending && playing ? <Heaven /> : null;
}

/* ------------------------------------------------------------------ tabs */

const TABS = [
  { id: "store", label: "Store" },
  { id: "achievements", label: "Achievements" },
  { id: "stats", label: "Stats" },
  { id: "options", label: "Options" },
  { id: "legacy", label: "Legacy" },
] as const;

type Tab = (typeof TABS)[number]["id"];

function Side() {
  const [tab, setTab] = useState<Tab>("store");
  const achievements = useGame((state) => state.achievements.size);
  // Legacy shows up once ascending would be worth something, and stays after that.
  const legacy = useGame(
    (state) => state.legacy.ascensions > 0 || engine.bakedAllTime(state) >= engine.PRESTIGE_UNIT,
  );
  const tabs = TABS.filter((t) => t.id !== "legacy" || legacy);
  const current = tabs.some((t) => t.id === tab) ? tab : "store";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Arrows move on from whichever tab has focus, which is usually the selected one.
    const focused = tabs.findIndex((t) => `tab-${t.id}` === (event.target as HTMLElement).id);
    const index = focused >= 0 ? focused : tabs.findIndex((t) => t.id === current);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };

  return (
    <section
      aria-label="Store and more"
      className="flex min-h-0 flex-col border-t border-faint/40 md:border-l md:border-t-0"
    >
      <div
        role="tablist"
        aria-label="Sections"
        onKeyDown={onKeyDown}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-faint/40 px-2 [scrollbar-width:none]"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === current}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === current ? 0 : -1}
            onClick={() => setTab(t.id)}
            className="relative shrink-0 px-2.5 py-2.5 text-[13.5px] text-muted transition-colors hover:text-ink aria-selected:text-ink aria-selected:after:absolute aria-selected:after:inset-x-2 aria-selected:after:bottom-0 aria-selected:after:h-0.5 aria-selected:after:rounded-full aria-selected:after:bg-accent"
          >
            {t.label}
            {t.id === "achievements" && (
              <span className="ml-1 text-[11.5px] tabular-nums text-muted">
                {achievements}/{ACHIEVEMENTS.length}
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${current}`}
        aria-labelledby={`tab-${current}`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {current === "store" && <Shop />}
        {current === "achievements" && <Achievements />}
        {current === "stats" && <Stats />}
        {current === "options" && <Options />}
        {current === "legacy" && <Legacy />}
      </div>
    </section>
  );
}
