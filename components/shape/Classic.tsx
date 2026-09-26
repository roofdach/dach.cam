"use client";

import { useState } from "react";
import { BY_CODE, MAX_GUESSES, TARGETS, dailyAnswer, dailyDate, dailyNumber, hintFor, msUntilNextDaily, shareText, type Country } from "@/lib/shape/game";
import { useLocalNow } from "@/components/game/clock";
import { KEYS, load, save } from "@/components/game/storage";
import { Button, formatWait, plural } from "@/components/game/ui";
import { CountryInput, Flag, Frame, Hints, Outline, ShareButton } from "./parts";

/**
 * The classic game: one outline, six guesses, and after each wrong one how
 * far away the answer is and which way. The daily is the same country for
 * everyone that day, played once; practice is a new one whenever you like.
 * Both carry on where you left off after a reload.
 */

interface Saved {
  /** The daily's date, or the practice country's code. */
  key: string;
  guesses: string[];
}

interface Stats {
  played: number;
  won: number;
  streak: number;
  best: number;
  /** The last daily finished, so a day counts once. */
  last: string;
  /** How many dailies were won in 1, 2, … 6 guesses. */
  spread: number[];
}

const isSaved = (value: unknown): value is Saved =>
  !!value && typeof value === "object" && typeof (value as Saved).key === "string" && Array.isArray((value as Saved).guesses) && (value as Saved).guesses.every((g) => BY_CODE.has(g));

const isStats = (value: unknown): value is Stats =>
  !!value && typeof value === "object" && typeof (value as Stats).played === "number" && Array.isArray((value as Stats).spread) && (value as Stats).spread.length === MAX_GUESSES;

const NO_STATS: Stats = { played: 0, won: 0, streak: 0, best: 0, last: "", spread: Array(MAX_GUESSES).fill(0) };

function randomTarget(not?: string): Country {
  const pool = TARGETS.filter((c) => c.code !== not);
  return pool[Math.floor(Math.random() * pool.length)];
}

function yesterday(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export function Classic({ mode }: { mode: "daily" | "practice" }) {
  const [today] = useState(dailyDate);
  const storageKey = mode === "daily" ? KEYS.shapeDaily : KEYS.shapePractice;
  const [game, setGame] = useState<Saved>(() => {
    const saved = load(storageKey, isSaved);
    if (mode === "daily") return saved?.key === today ? saved : { key: today, guesses: [] };
    return saved && BY_CODE.get(saved.key)?.target ? saved : { key: randomTarget().code, guesses: [] };
  });
  const [stats, setStats] = useState<Stats>(() => load(KEYS.shapeStats, isStats) ?? NO_STATS);

  const answer = mode === "daily" ? dailyAnswer(today) : BY_CODE.get(game.key)!;
  const hints = game.guesses.map((code) => hintFor(BY_CODE.get(code)!, answer));
  const won = game.guesses.includes(answer.code);
  const over = won || game.guesses.length >= MAX_GUESSES;
  const guessed = new Set(game.guesses);

  const guess = (country: Country) => {
    if (over || guessed.has(country.code)) return;
    const next = { ...game, guesses: [...game.guesses, country.code] };
    setGame(next);
    save(storageKey, next);
    const nowWon = country.code === answer.code;
    if (mode === "daily" && (nowWon || next.guesses.length >= MAX_GUESSES) && stats.last !== today) {
      const spread = [...stats.spread];
      if (nowWon) spread[next.guesses.length - 1]++;
      const streak = nowWon ? (stats.last === yesterday(today) && stats.streak > 0 ? stats.streak + 1 : 1) : 0;
      const updated = { played: stats.played + 1, won: stats.won + (nowWon ? 1 : 0), streak, best: Math.max(stats.best, streak), last: today, spread };
      setStats(updated);
      save(KEYS.shapeStats, updated);
    }
  };

  const again = () => {
    const next = { key: randomTarget(answer.code).code, guesses: [] };
    setGame(next);
    save(storageKey, next);
  };

  const title = mode === "daily" ? `daily #${dailyNumber(today)}` : "practice";
  return (
    <Frame title={title} right={<span className="text-[13px] text-muted">{over ? "" : `${MAX_GUESSES - game.guesses.length} left`}</span>}>
      <div className="grid place-items-center rounded-2xl bg-ink/[0.035] p-4">
        <Outline key={answer.code} shape={answer} className="h-[min(34vh,300px)] w-full text-ink animate-fade-in" />
      </div>
      <div className="mt-4">
        <Hints hints={hints} total={MAX_GUESSES} />
      </div>
      <div className="mt-4">
        {!over ? (
          <CountryInput onGuess={guess} exclude={guessed} />
        ) : (
          <Result
            answer={answer}
            won={won}
            guesses={game.guesses.length}
            share={mode === "daily" ? shareText(`shape #${dailyNumber(today)}`, hints, won, `${window.location.host}/shape`) : null}
            onAgain={mode === "practice" ? again : null}
            stats={mode === "daily" ? stats : null}
          />
        )}
      </div>
    </Frame>
  );
}

function Result({
  answer,
  won,
  guesses,
  share,
  onAgain,
  stats,
}: {
  answer: Country;
  won: boolean;
  guesses: number;
  share: string | null;
  onAgain: (() => void) | null;
  stats: Stats | null;
}) {
  return (
    <div className="animate-fade-in rounded-2xl border border-faint/70 p-4 text-center">
      <p className="text-[13px] text-muted">{won ? `got it in ${plural(guesses, "guess", "guesses")}` : "out of guesses"}</p>
      <p className="mt-1 flex items-center justify-center gap-2 text-[22px] font-semibold tracking-tight">
        <Flag code={answer.code} className="h-6" />
        {answer.name}
      </p>
      {answer.capital && <p className="mt-0.5 text-[13px] text-muted">capital: {answer.capital}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {share && <ShareButton text={share} label="share your result" />}
        {onAgain && (
          <Button tone="solid" onClick={onAgain} className="min-h-10 px-5">
            next country
          </Button>
        )}
        <a
          href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(answer.name)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center rounded-lg px-3 text-[13.5px] text-muted hover:text-ink"
        >
          see it on a map
        </a>
      </div>
      {stats && <DailyStats stats={stats} />}
    </div>
  );
}

function DailyStats({ stats }: { stats: Stats }) {
  const now = useLocalNow(30_000);
  const most = Math.max(1, ...stats.spread);
  return (
    <div className="mt-5 border-t border-faint/60 pt-4">
      <dl className="grid grid-cols-4 gap-2 text-center">
        {[
          ["played", stats.played],
          ["won", stats.played ? `${Math.round((100 * stats.won) / stats.played)}%` : "–"],
          ["streak", stats.streak],
          ["best", stats.best],
        ].map(([label, value]) => (
          <div key={label}>
            <dd className="text-[20px] font-semibold tabular-nums">{value}</dd>
            <dt className="text-[12px] text-muted">{label}</dt>
          </div>
        ))}
      </dl>
      <ol className="mx-auto mt-4 max-w-[18rem] space-y-1 text-left text-[12px]" aria-label="guesses it took">
        {stats.spread.map((count, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-3 text-muted">{i + 1}</span>
            <span className="h-4 rounded-sm bg-ink/70 px-1 text-right text-[11px] leading-4 text-paper" style={{ width: `${Math.max(8, (count / most) * 100)}%` }}>
              {count}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[12.5px] text-muted">a new shape in {formatWait(msUntilNextDaily(now))}</p>
    </div>
  );
}
