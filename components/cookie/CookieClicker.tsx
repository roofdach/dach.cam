"use client";

import dynamic from "next/dynamic";
import { CookieArt } from "./CookieArt";

/**
 * The game only exists in the browser: the save is in localStorage, and there
 * is nothing useful to render before it has been read.
 */
const Game = dynamic(() => import("./Game"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center" aria-busy="true">
      <div className="flex flex-col items-center gap-4 text-[13.5px] text-muted">
        <CookieArt className="size-24 animate-pulse opacity-80" />
        <p>Warming up the oven…</p>
      </div>
    </div>
  ),
});

export function CookieClicker() {
  return <Game />;
}
