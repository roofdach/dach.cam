"use client";

import dynamic from "next/dynamic";

function Skeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_16rem] lg:gap-10" aria-hidden>
      <div className="space-y-4">
        <div className="h-6 w-40 animate-pulse rounded bg-paper-2" />
        <div className="h-[26rem] animate-pulse rounded-xl bg-paper-2 lg:h-[32rem]" />
      </div>
      <div className="space-y-3">
        <div className="h-2.5 w-20 animate-pulse rounded bg-paper-2" />
        <div className="h-24 animate-pulse rounded bg-paper-2" />
      </div>
    </div>
  );
}

/**
 * The room gives this tab a random identity, so it is rendered on the client
 * only. Prerendering it would mean the server inventing a different person.
 */
const Room = dynamic(() => import("./Together").then((m) => m.Together), { ssr: false, loading: Skeleton });

export function TogetherClient() {
  return <Room />;
}
