"use client";

import dynamic from "next/dynamic";

/** The game only exists in the browser: it needs localStorage, a canvas and the screen's size. */
const PhoneApp = dynamic(() => import("./PhoneApp"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center" aria-busy="true">
      <p className="text-[13.5px] text-muted">Loading phone…</p>
    </div>
  ),
});

export function Phone(props: { room?: string; multiplayer: boolean }) {
  return <PhoneApp {...props} />;
}
