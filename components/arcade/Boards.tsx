"use client";

import { useState } from "react";
import type { Boards as BoardsData } from "@/lib/arcade/scores";

/** The high score boards: today's and all time's, with you picked out. */
export function Boards({ boards, me, best, unavailable = false }: { boards: BoardsData | null; me: string | null; best: number; unavailable?: boolean }) {
  const [tab, setTab] = useState<"today" | "all">("today");
  const lines = boards ? (tab === "today" ? boards.today : boards.all) : [];
  return (
    <section aria-labelledby="boards" className="rounded-xl border border-faint/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="boards" className="text-[15px] font-semibold">
          high scores
        </h2>
        <div role="tablist" aria-label="which board" className="flex gap-1 text-[12.5px]">
          {(["today", "all"] as const).map((which) => (
            <button
              key={which}
              type="button"
              role="tab"
              aria-selected={tab === which}
              onClick={() => setTab(which)}
              className={`rounded-md px-2 py-1 ${tab === which ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
            >
              {which === "today" ? "today" : "all time"}
            </button>
          ))}
        </div>
      </div>
      {unavailable ? (
        <p className="mt-3 text-[13px] text-muted">the boards need the site&rsquo;s database, which isn&rsquo;t set up here. your best is still kept on this device.</p>
      ) : !boards ? (
        <p className="mt-3 text-[13px] text-muted">loading…</p>
      ) : lines.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{tab === "today" ? "nobody's played today yet. be first." : "nobody's on the board yet. be first."}</p>
      ) : (
        <ol className="mt-3 space-y-1">
          {lines.map((line, i) => (
            <li key={line.who} className={`flex items-center gap-2 rounded-md px-2 py-1 text-[13.5px] ${line.who === me ? "bg-ink/[0.07] font-semibold" : ""}`}>
              <span className="w-6 text-right font-mono text-[12px] tabular-nums text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {line.name}
                {line.who === me && <span className="ml-1 text-[11.5px] font-normal text-muted">(you)</span>}
              </span>
              <span className="font-mono tabular-nums">{line.score}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[12.5px] text-muted">your best on this device: {best}</p>
    </section>
  );
}
