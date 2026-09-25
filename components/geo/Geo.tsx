"use client";

import dynamic from "next/dynamic";

/**
 * The game only exists in the browser: it needs localStorage, the screen's
 * size and Google's frame, and has nothing to show before those are there.
 */
const GeoApp = dynamic(() => import("./GeoApp"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center" aria-busy="true">
      <p className="text-[13.5px] text-muted">Loading geo…</p>
    </div>
  ),
});

export function Geo(props: { room?: string; multiplayer: boolean; streetView: boolean }) {
  return <GeoApp {...props} />;
}
