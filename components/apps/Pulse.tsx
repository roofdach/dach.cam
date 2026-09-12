"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { useElementSize } from "@/lib/hooks";
import { buildPath, resample, smooth, type Box } from "@/lib/pulse/chart";
import {
  bucketByDay,
  buildDemo,
  contributors,
  dayStarts,
  hourHistogram,
  latencyHistogram,
  quantile,
  reviewLatencies,
  trend,
  weekdayHistogram,
  WEEKDAYS,
  windowOf,
  type Commit,
  type Dataset,
} from "@/lib/pulse/dataset";
import { GitHubError, loadRepo } from "@/lib/pulse/github";
import { clamp } from "@/lib/random";

type Range = 7 | 30 | 90;
type Metric = "commits" | "pulls" | "review";

const RANGES: Range[] = [7, 30, 90];
const METRICS: { id: Metric; label: string; unit: string; decimals: number }[] = [
  { id: "commits", label: "commits", unit: "", decimals: 0 },
  { id: "pulls", label: "merged prs", unit: "", decimals: 0 },
  { id: "review", label: "median review", unit: "h", decimals: 1 },
];

const SAMPLES = 48;
const CHART_H = 240;
const PAD = { top: 16, right: 6, bottom: 24, left: 6 };
const HEATMAP_DAYS = 91;

function ago(ts: number, now: number): string {
  const minutes = Math.round((now - ts) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function Bars({
  rows,
  onToggle,
  active,
  format,
}: {
  rows: { name: string; value: number; color: string; share: number; meta?: string }[];
  onToggle?: (name: string) => void;
  active?: (name: string) => boolean;
  format?: (value: number) => string;
}) {
  if (!rows.length) return <p className="text-[12px] text-muted">nothing in this window.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const on = active ? active(row.name) : true;
        const content = (
          <>
            <span className="w-[5.5rem] shrink-0 truncate text-left text-ink-2" title={row.name}>
              {row.name}
            </span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-(--ease-out-quart)"
                style={{ width: `${Math.max(2, Math.round(row.share * 100))}%`, backgroundColor: row.color }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-muted tnum">
              {format ? format(row.value) : row.value}
            </span>
          </>
        );
        return (
          <li key={row.name}>
            {onToggle ? (
              <button
                onClick={() => onToggle(row.name)}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 text-[12px] transition-opacity ${on ? "" : "opacity-40"}`}
              >
                {content}
              </button>
            ) : (
              <div className="flex w-full items-center gap-3 text-[12px]">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Columns({ values, labels, caption }: { values: number[]; labels: string[]; caption: string }) {
  const max = Math.max(1, ...values);
  return (
    <figure>
      <figcaption className="label mb-3">{caption}</figcaption>
      <div className="flex h-24 items-end gap-[3px]">
        {values.map((value, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end" title={`${labels[i]}: ${value}`}>
            <div
              className="w-full rounded-sm bg-accent/70 transition-[height] duration-700 ease-(--ease-out-quart) group-hover:bg-accent"
              style={{ height: `${Math.max(2, (value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-faint">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </figure>
  );
}

function Heatmap({ counts, starts }: { counts: number[]; starts: number[] }) {
  const max = Math.max(1, ...counts);
  const firstWeekday = (new Date(starts[0]).getDay() + 6) % 7;
  const columns = Math.ceil((counts.length + firstWeekday) / 7);

  return (
    <div className="overflow-x-auto scrollbar-none">
      {/* Capped rather than stretched: a day stays a small square however wide the panel gets. */}
      <div
        className="grid w-fit min-w-[16rem] grid-flow-col gap-[3px]"
        style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))", gridTemplateColumns: `repeat(${columns}, minmax(7px, 15px))` }}
        role="img"
        aria-label={`Commits per day over the last ${counts.length} days`}
      >
        {Array.from({ length: columns * 7 }, (_, cell) => {
          const index = cell - firstWeekday;
          if (index < 0 || index >= counts.length) return <div key={cell} aria-hidden />;
          const value = counts[index];
          const share = value / max;
          const date = new Date(starts[index]);
          return (
            <div
              key={cell}
              title={`${date.toDateString().toLowerCase()} · ${value} commit${value === 1 ? "" : "s"}`}
              className="aspect-square rounded-[2px]"
              style={{
                backgroundColor: value
                  ? `color-mix(in srgb, var(--accent) ${Math.round(18 + share * 82)}%, var(--line))`
                  : "var(--line)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function Pulse() {
  const reduce = useReducedMotion();
  const [now] = useState(() => Date.now());
  const [dataset, setDataset] = useState<Dataset>(() => buildDemo(now));
  const [range, setRange] = useState<Range>(30);
  const [metric, setMetric] = useState<Metric>("commits");
  /** null means "everyone" / "every language", which keeps the empty case simple. */
  const [people, setPeople] = useState<Set<string> | null>(null);
  const [langs, setLangs] = useState<Set<string> | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { ref: chartRef, width } = useElementSize<HTMLDivElement>();
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const load = async (target: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await loadRepo(target, controller.signal);
      setDataset(next);
      setPeople(null);
      setLangs(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof GitHubError ? err.message : "couldn't reach github from this browser.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const useDemo = () => {
    request.current?.abort();
    setDataset(buildDemo(now));
    setPeople(null);
    setLangs(null);
    setError(null);
    setLoading(false);
  };

  const filtered = useMemo(
    () => ({
      ...dataset,
      commits: dataset.commits.filter(
        (c) => (!people || people.has(c.author)) && (!langs || !c.lang || langs.has(c.lang)),
      ),
      pulls: dataset.pulls.filter((p) => !people || people.has(p.author)),
    }),
    [dataset, people, langs],
  );

  const view = useMemo(() => windowOf(filtered, range, now), [filtered, range, now]);

  const mergedAsCommits = useMemo<Commit[]>(
    () =>
      view.pulls
        .filter((p) => p.merged !== null)
        .map((p) => ({ ts: p.merged!, author: p.author, message: p.title })),
    [view.pulls],
  );

  const daily = useMemo(() => {
    const commits = bucketByDay(view.commits, view.starts);
    const merged = bucketByDay(mergedAsCommits, view.starts);
    // Average hours to merge, per day, so an empty day reads as a gap not a zero.
    const sums = new Array<number>(view.starts.length).fill(0);
    const counts = new Array<number>(view.starts.length).fill(0);
    view.pulls.forEach((pull) => {
      if (pull.merged === null) return;
      let i = view.starts.length - 1;
      while (i > 0 && pull.merged < view.starts[i]) i--;
      if (pull.merged < view.starts[0]) return;
      sums[i] += (pull.merged - pull.created) / 3_600_000;
      counts[i]++;
    });
    const review = sums.map((sum, i) => (counts[i] ? sum / counts[i] : 0));
    return { commits, merged, review };
  }, [view, mergedAsCommits]);

  const series = daily[metric === "pulls" ? "merged" : metric];
  const sampled = useMemo(() => resample(smooth(series, range >= 90 ? 5 : 1), SAMPLES), [series, range]);
  const max = useMemo(() => Math.max(1, ...sampled) * 1.15, [sampled]);

  const latencies = useMemo(() => reviewLatencies(view.pulls), [view.pulls]);
  const people_ = useMemo(() => contributors(view.commits, view.pulls), [view.commits, view.pulls]);

  const totals = useMemo(() => {
    const commits = view.commits.length;
    const merged = mergedAsCommits.length;
    const median = quantile(latencies, 0.5);
    const p90 = quantile(latencies, 0.9);
    const active = daily.commits.filter((c) => c > 0).length;
    return { commits, merged, median, p90, active, delta: trend(daily.commits) };
  }, [view.commits.length, mergedAsCommits.length, latencies, daily.commits]);

  const heat = useMemo(() => {
    const starts = dayStarts(now, HEATMAP_DAYS);
    return { starts, counts: bucketByDay(filtered.commits, starts) };
  }, [filtered.commits, now]);

  const languageRows = useMemo(() => {
    const top = Math.max(1, ...dataset.languages.map((l) => l.value));
    return dataset.languages.slice(0, 6).map((l) => ({ ...l, share: l.value / top }));
  }, [dataset.languages]);

  const chartW = Math.max(280, width);
  const box: Box = { width: chartW, height: CHART_H, ...PAD };
  const linePath = buildPath(sampled, box, max, false);
  const areaPath = buildPath(sampled, box, max, true);
  const transition = reduce ? { duration: 0 } : { duration: 0.7, ease: [0.25, 1, 0.5, 1] as const };
  const metricMeta = METRICS.find((m) => m.id === metric)!;

  const hoverInfo = (() => {
    if (hover === null || series.length < 2) return null;
    const i = clamp(Math.round((hover / chartW) * (series.length - 1)), 0, series.length - 1);
    const innerW = chartW - PAD.left - PAD.right;
    const innerH = CHART_H - PAD.top - PAD.bottom;
    const x = PAD.left + (i / (series.length - 1)) * innerW;
    const y = PAD.top + innerH - (series[i] / max) * innerH;
    const daysAgo = series.length - 1 - i;
    return {
      x,
      y,
      value: series[i],
      label: daysAgo === 0 ? "today" : `${daysAgo}d ago`,
      date: new Date(view.starts[i]).toDateString().toLowerCase().slice(0, 10),
    };
  })();

  const toggle = (set: Set<string> | null, all: string[], name: string): Set<string> | null => {
    const current = set ?? new Set(all);
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    if (!next.size || next.size === all.length) return null;
    return next;
  };

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={`size-2 rounded-full ${dataset.source === "github" ? "bg-[#5b8a72]" : "bg-accent"}`} aria-hidden />
            <h2 className="truncate text-[15px] font-medium tracking-tight text-ink">{dataset.label}</h2>
            {loading && <span className="text-[12px] text-muted">loading…</span>}
          </div>
          {dataset.note && <p className="mt-1.5 text-[12.5px] text-muted">{dataset.note}</p>}
          {error && (
            <p className="mt-1.5 text-[12.5px] text-accent" role="status">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (repoInput.trim()) void load(repoInput);
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor="pulse-repo" className="sr-only">
              GitHub repository
            </label>
            <input
              id="pulse-repo"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="owner/repo"
              spellCheck={false}
              autoComplete="off"
              className="w-[11rem] rounded-md border border-line bg-paper px-2.5 py-1 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={loading || !repoInput.trim()}
              className="rounded-md border border-line px-2.5 py-1 text-[12.5px] text-muted transition-colors hover:border-faint hover:text-ink disabled:opacity-40"
            >
              load
            </button>
          </form>
          {dataset.source === "github" && (
            <button onClick={useDemo} className="text-[12.5px] text-muted transition-colors hover:text-ink">
              back to demo data
            </button>
          )}

          <div role="tablist" aria-label="Range" className="relative flex rounded-full border border-line bg-paper p-0.5 text-[12px]">
            {RANGES.map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={range === r}
                onClick={() => setRange(r)}
                className={`relative z-10 rounded-full px-3 py-1 tnum transition-colors ${
                  range === r ? "text-paper" : "text-muted hover:text-ink"
                }`}
              >
                {range === r && (
                  <motion.span
                    layoutId="pulse-range"
                    className="absolute inset-0 -z-10 rounded-full bg-ink"
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                {r}d
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-x-8 gap-y-5 border-y border-line py-6 sm:grid-cols-4">
        {METRICS.map((m) => {
          const value = m.id === "commits" ? totals.commits : m.id === "pulls" ? totals.merged : totals.median;
          const selected = metric === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              aria-pressed={selected}
              className={`group text-left transition-colors ${selected ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              <div className="label flex items-center gap-1.5">
                <span
                  className={`inline-block h-px w-3 transition-colors ${selected ? "bg-accent" : "bg-faint group-hover:bg-muted"}`}
                />
                {m.label}
              </div>
              <div className="mt-2 text-[28px] leading-none tracking-tight">
                <AnimatedNumber value={value} decimals={m.decimals} suffix={m.unit} />
              </div>
            </button>
          );
        })}
        <div className="text-muted">
          <div className="label flex items-center gap-1.5">
            <span className="inline-block h-px w-3 bg-faint" />
            active days
          </div>
          <div className="mt-2 text-[28px] leading-none tracking-tight">
            <AnimatedNumber value={totals.active} />
            <span className="ml-1.5 text-[13px]">
              / {range}
              <span className={`ml-2 tnum ${totals.delta >= 0 ? "text-[#5b8a72]" : "text-accent"}`}>
                {totals.delta >= 0 ? "+" : ""}
                {totals.delta}%
              </span>
            </span>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="label">
            {metricMeta.label} · last {range} days
          </h3>
          <p className="text-[12px] text-muted">hover the chart</p>
        </div>
        <div
          ref={chartRef}
          className="relative -mx-1 select-none"
          onPointerMove={(e) => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left)}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            width="100%"
            height={CHART_H}
            viewBox={`0 0 ${chartW} ${CHART_H}`}
            role="img"
            aria-label={`${metricMeta.label} over the last ${range} days`}
            className="block overflow-visible"
          >
            <defs>
              <linearGradient id="pulse-app-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((t) => {
              const y = PAD.top + (CHART_H - PAD.top - PAD.bottom) * t;
              return <line key={t} x1={PAD.left} x2={chartW - PAD.right} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 4" />;
            })}
            <motion.path d={areaPath} fill="url(#pulse-app-fill)" animate={{ d: areaPath }} transition={transition} />
            <motion.path
              d={linePath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.6}
              strokeLinejoin="round"
              animate={{ d: linePath }}
              transition={transition}
            />
            {hoverInfo && (
              <g>
                <line x1={hoverInfo.x} x2={hoverInfo.x} y1={PAD.top} y2={CHART_H - PAD.bottom} stroke="var(--faint)" />
                <circle cx={hoverInfo.x} cy={hoverInfo.y} r={3.5} fill="var(--paper)" stroke="var(--accent)" strokeWidth={1.6} />
              </g>
            )}
            <text x={PAD.left} y={CHART_H - 6} className="fill-muted font-mono text-[10px]">
              {range}d ago
            </text>
            <text x={chartW - PAD.right} y={CHART_H - 6} textAnchor="end" className="fill-muted font-mono text-[10px]">
              today
            </text>
          </svg>
          <AnimatePresence>
            {hoverInfo && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-none absolute top-0 rounded-md border border-line bg-paper px-2 py-1 font-mono text-[11px] text-ink shadow-sm"
                style={{ left: clamp(hoverInfo.x, 56, chartW - 56), transform: "translateX(-50%)" }}
              >
                <span className="tnum">
                  {metric === "review" ? `${hoverInfo.value.toFixed(1)}h` : hoverInfo.value}
                </span>
                <span className="ml-1.5 text-muted">{hoverInfo.label}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="label mb-3">every day, last {HEATMAP_DAYS} days</h3>
          <Heatmap counts={heat.counts} starts={heat.starts} />
          <p className="mt-3 text-[12px] text-muted tnum">
            {heat.counts.reduce((a, b) => a + b, 0)} commits · busiest day {Math.max(0, ...heat.counts)}
          </p>
        </div>

        <div>
          <h3 className="label mb-3">review time</h3>
          {latencies.length ? (
            <>
              <Columns
                values={latencyHistogram(latencies).map((b) => b.count)}
                labels={latencyHistogram(latencies).map((b) => b.label)}
                caption="time from opening to merge"
              />
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                <dt className="text-muted">median</dt>
                <dd className="text-ink-2 tnum">{quantile(latencies, 0.5).toFixed(1)}h</dd>
                <dt className="text-muted">90th</dt>
                <dd className="text-ink-2 tnum">{quantile(latencies, 0.9).toFixed(1)}h</dd>
                <dt className="text-muted">merged</dt>
                <dd className="text-ink-2 tnum">{latencies.length}</dd>
              </dl>
            </>
          ) : (
            <p className="text-[12px] text-muted">no pull requests were merged in this window.</p>
          )}
        </div>
      </section>

      <section className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <h3 className="label mb-3">people</h3>
          <Bars
            rows={people_.slice(0, 7).map((c) => ({
              name: c.name,
              value: c.commits,
              color: "var(--accent)",
              share: c.share,
            }))}
            onToggle={(name) => setPeople((prev) => toggle(prev, contributors(dataset.commits, dataset.pulls).map((c) => c.name), name))}
            active={(name) => !people || people.has(name)}
          />
          {people && (
            <button onClick={() => setPeople(null)} className="mt-3 text-[11.5px] text-muted transition-colors hover:text-ink">
              show everyone
            </button>
          )}
        </div>

        <div>
          <h3 className="label mb-3">languages</h3>
          <Bars
            rows={languageRows.map((l) => ({ name: l.name, value: l.value, color: l.color, share: l.share }))}
            onToggle={
              dataset.canFilterByLanguage
                ? (name) => setLangs((prev) => toggle(prev, dataset.languages.map((l) => l.name), name))
                : undefined
            }
            active={(name) => !langs || langs.has(name)}
            format={(value) =>
              dataset.languageUnit === "bytes"
                ? value > 1_000_000
                  ? `${(value / 1_000_000).toFixed(1)}m`
                  : `${Math.round(value / 1000)}k`
                : String(value)
            }
          />
          {!dataset.canFilterByLanguage && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              bytes per language, from the repository. filtering by it would need one request per commit.
            </p>
          )}
        </div>

        <Columns
          values={hourHistogram(view.commits)}
          labels={Array.from({ length: 24 }, (_, h) => `${h}:00`)}
          caption="hour of day"
        />

        <Columns values={weekdayHistogram(view.commits)} labels={WEEKDAYS} caption="day of week" />
      </section>

      <section>
        <h3 className="label mb-3">latest commits</h3>
        <ul className="divide-y divide-line border-y border-line">
          {view.commits.slice(0, 8).map((commit, i) => (
            <li key={`${commit.ts}-${i}`} className="flex items-baseline gap-3 py-2.5 text-[13px]">
              <span className="w-[5.5rem] shrink-0 truncate text-ink">{commit.author}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{commit.message}</span>
              {commit.lang && <span className="hidden shrink-0 font-mono text-[11px] text-faint sm:block">{commit.lang}</span>}
              <span className="w-12 shrink-0 text-right text-muted tnum">{ago(commit.ts, now)}</span>
            </li>
          ))}
          {!view.commits.length && <li className="py-3 text-[13px] text-muted">nothing matches these filters.</li>}
        </ul>
      </section>
    </div>
  );
}
