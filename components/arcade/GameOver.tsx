"use client";

import { useState, type FormEvent } from "react";
import { KEYS, isString, load } from "@/components/game/storage";
import type { SoloResult } from "./useSolo";

/** Laid over a game when a run ends: the score, where it puts you, and another go. */
export function GameOver({ result, best, counts, word, onAgain, onName }: { result: SoloResult; best: number; counts: boolean; word: string; onAgain: () => void; onName: (name: string) => void }) {
  const [name, setName] = useState(() => load(KEYS.name, isString) ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onName(name);
  };
  const { standing } = result;
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/35 p-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="w-full max-w-[16rem] animate-pop rounded-xl bg-[#fdf6dd] p-4 text-center text-[#3a2a14] shadow-xl">
        <p className="text-[13px] font-bold uppercase tracking-wide text-[#b5651d]">game over</p>
        <p className="mt-1 text-[44px] font-black leading-none tabular-nums">{result.score}</p>
        <p className="text-[12.5px]">{word}</p>
        {result.record && result.score > 0 && <p className="mt-2 inline-block rounded-full bg-[#f26b3a] px-2.5 py-0.5 text-[12px] font-bold text-white">new best!</p>}
        <p className="mt-2 text-[12.5px]">your best: {best}</p>
        <div className="mt-2 min-h-5 text-[12.5px]">
          {result.sending ? (
            <p>putting it on the board…</p>
          ) : result.error ? (
            <p className="text-[#c92a2a]">{result.error}</p>
          ) : standing ? (
            <p className="font-semibold">
              {standing.todayRank ? `#${standing.todayRank} today` : "not in today's top"}
              {standing.rank ? ` · #${standing.rank} all time` : ""}
            </p>
          ) : result.needsName ? (
            <form onSubmit={submit} className="mt-1 flex gap-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={16}
                placeholder="your name"
                aria-label="your name, for the board"
                autoComplete="nickname"
                className="min-w-0 flex-1 rounded-md border border-[#3a2a14]/30 bg-white px-2 py-1 text-[14px] outline-none focus:border-[#3a2a14]"
              />
              <button type="submit" disabled={!name.trim()} className="rounded-md bg-[#3a2a14] px-2.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
                save
              </button>
            </form>
          ) : !counts ? (
            <p className="text-[#8a6a3a]">offline: this one won&rsquo;t go on the board.</p>
          ) : null}
        </div>
        <button type="button" onClick={onAgain} className="mt-3 min-h-10 w-full rounded-lg bg-[#f26b3a] text-[15px] font-bold text-white shadow-[0_3px_0_#b5451a] active:translate-y-0.5 active:shadow-none">
          play again
        </button>
      </div>
    </div>
  );
}
