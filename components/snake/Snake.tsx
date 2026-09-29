"use client";

import dynamic from "next/dynamic";

/** The game only exists in the browser: it needs a canvas, and your best is kept there. */
const SnakeApp = dynamic(() => import("./SnakeApp"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center" aria-busy="true">
      <p className="text-[13.5px] text-muted">Loading snake…</p>
    </div>
  ),
});

export function Snake(props: { room?: string; multiplayer: boolean }) {
  return <SnakeApp {...props} />;
}
