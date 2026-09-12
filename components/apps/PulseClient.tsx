"use client";

import dynamic from "next/dynamic";

function Skeleton() {
  return (
    <div className="space-y-10" aria-hidden>
      <div className="h-6 w-52 animate-pulse rounded bg-paper-2" />
      <div className="grid grid-cols-2 gap-8 border-y border-line py-6 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-2.5 w-20 animate-pulse rounded bg-paper-2" />
            <div className="h-7 w-16 animate-pulse rounded bg-paper-2" />
          </div>
        ))}
      </div>
      <div className="h-[240px] animate-pulse rounded-lg bg-paper-2" />
    </div>
  );
}

/**
 * The dashboard reads the clock to decide what "today" means, so it is rendered
 * on the client only rather than being prerendered against the server's clock.
 */
const Dashboard = dynamic(() => import("./Pulse").then((m) => m.Pulse), { ssr: false, loading: Skeleton });

export function PulseClient() {
  return <Dashboard />;
}
