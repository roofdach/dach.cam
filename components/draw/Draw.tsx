"use client";

import dynamic from "next/dynamic";

/** The game only exists in the browser: it needs localStorage, a canvas and the screen's size. */
const DrawApp = dynamic(() => import("./DrawApp"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center" aria-busy="true">
      <p className="text-[13.5px] text-muted">Loading draw…</p>
    </div>
  ),
});

export function Draw(props: { room?: string; multiplayer: boolean }) {
  return <DrawApp {...props} />;
}
