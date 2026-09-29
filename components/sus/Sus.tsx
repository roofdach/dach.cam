"use client";

import dynamic from "next/dynamic";

/** The game only exists in the browser: it needs localStorage, and your view is unsealed there. */
const SusApp = dynamic(() => import("./SusApp"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center" aria-busy="true">
      <p className="text-[13.5px] text-muted">Loading sus…</p>
    </div>
  ),
});

export function Sus(props: { room?: string; multiplayer: boolean }) {
  return <SusApp {...props} />;
}
