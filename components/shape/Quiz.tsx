"use client";

import { useMemo, useState, type ReactNode } from "react";
import { BY_CODE, QUIZ_ROUNDS, hintFor, quiz, quizPoints, type Country } from "@/lib/shape/game";
import { Button } from "@/components/game/ui";
import { CountryInput, Flag, Frame, Hints, Outline, ShareButton } from "./parts";

/**
 * Quiz: five countries. For each, name it from its outline (three goes,
 * with hints), then pick its flag, its capital, and the countries it
 * borders. The wrong answers come from its own neighbourhood, so they're not
 * give-aways.
 */

const OUTLINE_GOES = 3;

type Stage = "outline" | "flag" | "capital" | "neighbours";

interface Result {
  code: string;
  /** Guesses it took to name the outline; null if not named. */
  outline: number | null;
  flag: boolean;
  capital: boolean | null;
  neighbours: boolean | null;
  points: number;
  max: number;
}

export function Quiz() {
  const [seed, setSeed] = useState(() => String(Math.random()));
  const rounds = useMemo(() => quiz(seed), [seed]);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("outline");
  const [guesses, setGuesses] = useState<string[]>([]);
  const [flag, setFlag] = useState<string | null>(null);
  const [capital, setCapital] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const finished = results.length === rounds.length;
  const round = rounds[Math.min(index, rounds.length - 1)];
  const answer = BY_CODE.get(round.answer)!;
  const named = guesses.includes(answer.code);
  const outlineDone = named || guesses.length >= OUTLINE_GOES;

  const restart = () => {
    setSeed(String(Math.random()));
    setIndex(0);
    setResults([]);
    reset();
  };

  function reset() {
    setStage("outline");
    setGuesses([]);
    setFlag(null);
    setCapital(null);
    setChosen(new Set());
    setChecked(false);
  }

  /** On to the next stage that has a question, or the next country. */
  const advance = () => {
    const order: Stage[] = ["outline", "flag", "capital", "neighbours"];
    const next = order.slice(order.indexOf(stage) + 1).find((s) => (s === "capital" ? round.capitals !== null : s === "neighbours" ? round.neighbours !== null : true));
    if (next) return setStage(next);
    const neighboursRight = round.neighbours ? sameSet(chosen, round.neighbours.correct) : null;
    const capitalRight = round.capitals ? capital === answer.capital : null;
    const outline = named ? guesses.length : null;
    const points = quizPoints(outline, flag === answer.code, capitalRight, neighboursRight);
    const max = quizPoints(1, true, round.capitals ? true : null, round.neighbours ? true : null);
    setResults((r) => [...r, { code: answer.code, outline, flag: flag === answer.code, capital: capitalRight, neighbours: neighboursRight, points, max }]);
    if (index + 1 < rounds.length) {
      setIndex(index + 1);
      reset();
    }
  };

  if (finished) return <Summary results={results} onAgain={restart} />;

  const progress = `${index + 1} of ${QUIZ_ROUNDS}`;
  return (
    <Frame title="quiz" right={<span className="text-[13px] text-muted">{progress}</span>}>
      <Steps stage={stage} hasCapital={round.capitals !== null} hasNeighbours={round.neighbours !== null} />
      {stage === "outline" && (
        <>
          <div className="mt-3 grid place-items-center rounded-2xl bg-ink/[0.035] p-4">
            <Outline key={answer.code} shape={answer} className="h-[min(30vh,260px)] w-full text-ink animate-fade-in" />
          </div>
          <div className="mt-3">
            <Hints hints={guesses.map((g) => hintFor(BY_CODE.get(g)!, answer))} total={OUTLINE_GOES} />
          </div>
          <div className="mt-3">
            {outlineDone ? (
              <Verdict right={named} text={named ? `it's ${answer.name}` : `it was ${answer.name}`} onNext={advance} next="next: its flag" />
            ) : (
              <CountryInput onGuess={(c: Country) => setGuesses((g) => [...g, c.code])} exclude={new Set(guesses)} placeholder="which country is this?" />
            )}
          </div>
        </>
      )}

      {stage === "flag" && (
        <Question title={`which is the flag of ${answer.name}?`}>
          <div className="grid grid-cols-2 gap-3">
            {round.flags.map((code) => (
              <button
                key={code}
                type="button"
                disabled={flag !== null}
                onClick={() => setFlag(code)}
                aria-label={flag === null ? `flag ${round.flags.indexOf(code) + 1}` : BY_CODE.get(code)!.name}
                className={`rounded-xl border-2 p-2 transition-colors ${mark(flag, code, answer.code)}`}
              >
                <Flag code={code} className="w-full" />
                {flag !== null && <span className="mt-1 block truncate text-[12px]">{BY_CODE.get(code)!.name}</span>}
              </button>
            ))}
          </div>
          {flag !== null && <Verdict right={flag === answer.code} text={flag === answer.code ? "that's the one" : "not that one"} onNext={advance} next="next" />}
        </Question>
      )}

      {stage === "capital" && round.capitals && (
        <Question title={`what's the capital of ${answer.name}?`}>
          <div className="grid gap-2 sm:grid-cols-2">
            {round.capitals.map((city) => (
              <button
                key={city}
                type="button"
                disabled={capital !== null}
                onClick={() => setCapital(city)}
                className={`min-h-12 rounded-xl border-2 px-3 text-[15px] font-medium transition-colors ${mark(capital, city, answer.capital!)}`}
              >
                {city}
              </button>
            ))}
          </div>
          {capital !== null && <Verdict right={capital === answer.capital} text={capital === answer.capital ? "right" : `it's ${answer.capital}`} onNext={advance} next="next" />}
        </Question>
      )}

      {stage === "neighbours" && round.neighbours && (
        <Question title={`which of these share a border with ${answer.name}?`} note="pick all that do">
          <div className="grid grid-cols-2 gap-2">
            {round.neighbours.options.map((code) => {
              const on = chosen.has(code);
              const right = round.neighbours!.correct.includes(code);
              const look = !checked
                ? on
                  ? "border-ink bg-ink text-paper"
                  : "border-faint/70 hover:border-ink/40"
                : right
                  ? on
                    ? "border-[#2b8a3e] bg-[#d3f9d8] text-[#2b8a3e] dark:bg-[#1f3d25] dark:text-[#8ce99a]"
                    : "border-[#2b8a3e] border-dashed"
                  : on
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-faint/50 opacity-60";
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  disabled={checked}
                  onClick={() => setChosen((c) => toggle(c, code))}
                  className={`flex min-h-11 items-center gap-2 rounded-xl border-2 px-3 text-left text-[14px] font-medium transition-colors ${look}`}
                >
                  <Flag code={code} className="h-3.5 shrink-0" />
                  <span className="truncate">{BY_CODE.get(code)!.name}</span>
                </button>
              );
            })}
          </div>
          {!checked ? (
            <Button tone="solid" onClick={() => setChecked(true)} className="mt-4 min-h-10 w-full">
              check
            </Button>
          ) : (
            <Verdict
              right={sameSet(chosen, round.neighbours.correct)}
              text={sameSet(chosen, round.neighbours.correct) ? "all of them, and only them" : "the dashed ones border it"}
              onNext={advance}
              next={index + 1 < rounds.length ? "next country" : "see your score"}
            />
          )}
        </Question>
      )}
    </Frame>
  );
}

const sameSet = (a: ReadonlySet<string>, b: readonly string[]) => a.size === b.length && b.every((x) => a.has(x));

function toggle(set: ReadonlySet<string>, value: string) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** How an option looks once one's picked: the right one green, a wrong pick red. */
function mark(picked: string | null, option: string, right: string) {
  if (picked === null) return "border-faint/70 hover:border-ink/40";
  if (option === right) return "border-[#2b8a3e] bg-[#d3f9d8] text-[#2b8a3e] dark:bg-[#1f3d25] dark:text-[#8ce99a]";
  if (option === picked) return "border-accent bg-accent/10 text-accent";
  return "border-faint/50 opacity-60";
}

function Steps({ stage, hasCapital, hasNeighbours }: { stage: Stage; hasCapital: boolean; hasNeighbours: boolean }) {
  const steps: [Stage, string][] = [["outline", "shape"], ["flag", "flag"], ...(hasCapital ? [["capital", "capital"] as [Stage, string]] : []), ...(hasNeighbours ? [["neighbours", "neighbours"] as [Stage, string]] : [])];
  const at = steps.findIndex(([s]) => s === stage);
  return (
    <ol className="flex gap-1.5 text-[12px]" aria-label="this country's questions">
      {steps.map(([s, label], i) => (
        <li key={s} aria-current={i === at ? "step" : undefined} className={`flex-1 rounded-full py-1 text-center ${i < at ? "bg-ink/15 text-ink" : i === at ? "bg-ink text-paper" : "bg-ink/[0.05] text-muted"}`}>
          {label}
        </li>
      ))}
    </ol>
  );
}

function Question({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-5 animate-fade-in">
      <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
      {note && <p className="mt-0.5 text-[13px] text-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Verdict({ right, text, onNext, next }: { right: boolean; text: string; onNext: () => void; next: string }) {
  return (
    <div className="mt-4 flex items-center gap-3 animate-fade-in">
      <p className={`flex-1 text-[15px] font-semibold ${right ? "text-[#2b8a3e] dark:text-[#8ce99a]" : "text-accent"}`}>{text}</p>
      <Button tone="solid" onClick={onNext} autoFocus className="min-h-10 px-5">
        {next}
      </Button>
    </div>
  );
}

function Summary({ results, onAgain }: { results: Result[]; onAgain: () => void }) {
  const points = results.reduce((n, r) => n + r.points, 0);
  const max = results.reduce((n, r) => n + r.max, 0);
  const tick = (value: boolean | null) => (value === null ? "–" : value ? "✓" : "✗");
  return (
    <Frame title="quiz">
      <div className="animate-fade-in rounded-2xl border border-faint/70 p-5 text-center">
        <p className="text-[13px] text-muted">you scored</p>
        <p className="text-[34px] font-semibold tracking-tight tabular-nums">
          {points}
          <span className="text-[20px] text-muted"> / {max}</span>
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button tone="solid" onClick={onAgain} className="min-h-10 px-5">
            another quiz
          </Button>
          <ShareButton text={`shape quiz: ${points}/${max} 🧭\n${window.location.host}/shape`} label="share your score" />
        </div>
      </div>
      <table className="mt-5 w-full text-[13.5px]">
        <thead className="text-[12px] text-muted">
          <tr>
            <th className="py-1 text-left font-normal">country</th>
            <th className="font-normal">shape</th>
            <th className="font-normal">flag</th>
            <th className="font-normal">capital</th>
            <th className="font-normal">borders</th>
            <th className="text-right font-normal">points</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.code} className="border-t border-faint/50">
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <Flag code={r.code} className="h-3.5" />
                  {BY_CODE.get(r.code)!.name}
                </span>
              </td>
              <td className="text-center">{r.outline === null ? "✗" : `✓${r.outline > 1 ? ` (${r.outline})` : ""}`}</td>
              <td className="text-center">{tick(r.flag)}</td>
              <td className="text-center">{tick(r.capital)}</td>
              <td className="text-center">{tick(r.neighbours)}</td>
              <td className="text-right tabular-nums">
                {r.points}/{r.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}
