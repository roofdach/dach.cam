"use client";

import dynamic from "next/dynamic";

/** The game only exists in the browser: it needs localStorage and the day's date, and has nothing to show before those. */
const ShapeApp = dynamic(() => import("./ShapeApp"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center" aria-busy="true">
      <p className="text-[13.5px] text-muted">Loading shape…</p>
    </div>
  ),
});

export function Shape(props: { room?: string; multiplayer: boolean }) {
  return <ShapeApp {...props} />;
}
