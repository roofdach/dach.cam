"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { useElementSize } from "@/lib/hooks";
import { buildPath, resample, smooth, type Box } from "@/lib/pulse/chart";
import { clamp, lerp, seeded } from "@/lib/random";
import { AnimatedNumber } from "../AnimatedNumber";

type Range = 7 | 30 | 90;
type Metric = "commits" | "prs" | "review";

const RANGES: Range[] = [7, 30, 90];
const METRICS: { id: Metric; label: string; unit?: string }[] = [
  { id: "commits", label: "commits" },
  { id: "prs", label: "pull requests" },
  { id: "review", label: "review time", unit: "h" },
];

const LANGUAGES = [
  { id: "ts", label: "typescript", color: "#3b6ea5", weight: 0.52 },
  { id: "css", label: "css", color: "#b7502f", weight: 0.21 },
  { id: "rs", label: "rust", color: "#8a7d5c", weight: 0.17 },
  { id: "py", label: "python", color: "#5b8a72", weight: 0.1 },
] as const;

type LangId = (typeof LANGUAGES)[number]["id"];

interface Day {
  day: number;
  commits: Record<LangId, number>;
  prs: Record<LangId, number>;
  review: Record<LangId, number>;
}

const SAMPLES = 48;
const CHART_H = 230;
const PAD = { top: 14, bottom: 22, left: 6, right: 6 };
const boxFor = (width: number): Box => ({ width, height: CHART_H, ...PAD });

// 90 days of deterministic data. Each range is a suffix of the same series,
// which is what makes switching ranges feel continuous rather than random.
const DAYS: Day[] = (() => {
  const rand = seeded(42);
  const out: Day[] = [];
  for (let d = 0; d < 90; d++) {
    const weekday = d % 7;
    const weekend = weekday === 5 || weekday === 6;
    const dayOff = weekend && rand() < 0.55;
    const drift = 0.75 + 0.5 * Math.sin(d / 11) + 0.25 * Math.sin(d / 3.7);
    const base = dayOff ? 0 : clamp((6 + drift * 6) * (weekend ? 0.4 : 1) + rand() * 6, 0, 24);
    const commits = {} as Record<LangId, number>;
    const prs = {} as Record<LangId, number>;
    const review = {} as Record<LangId, number>;
    for (const lang of LANGUAGES) {
      commits[lang.id] = Math.round(base * lang.weight * (0.7 + rand() * 0.6));
      prs[lang.id] = Math.round(commits[lang.id] / (3 + rand() * 3));
      review[lang.id] = dayOff ? 0 : +(lang.weight * (1.5 + rand() * 4) * (weekend ? 0.5 : 1)).toFixed(1);
    }
    out.push({ day: d, commits, prs, review });
  }
  return out;
})();

const PEOPLE = ["mara", "jules", "sam", "iko", "ren", "theo"];
const VERBS: Record<Metric, string[]> = {
  commits: ["pushed to", "amended", "rebased"],
  prs: ["opened a pr in", "merged", "requested changes on"],
  review: ["reviewed", "approved", "left comments on"],
};
const REPOS: Record<LangId, string[]> = {
  ts: ["web/app", "design-system", "api-client"],
  css: ["design-system", "marketing"],
  rs: ["indexer", "cli"],
  py: ["pipelines", "scripts"],
};

export function AnalyticsPreview() {
  const reduce = useReducedMotion();
  const [range, setRange] = useState<Range>(30);
  const [metric, setMetric] = useState<Metric>("commits");
  const [langs, setLangs] = useState<Set<LangId>>(() => new Set(LANGUAGES.map((l) => l.id)));
  const [hover, setHover] = useState<number | null>(null);
  const { ref, width } = useElementSize<HTMLDivElement>();

  const days = useMemo(() => DAYS.slice(90 - range), [range]);

  const series = useMemo(() => {
    const raw = days.map((d) => {
      let sum = 0;
      for (const id of langs) sum += d[metric][id];
      return metric === "review" ? +sum.toFixed(1) : sum;
    });
    return { raw, sampled: resample(smooth(raw, range >= 90 ? 5 : 1), SAMPLES) };
  }, [days, langs, metric, range]);

  const max = useMemo(() => Math.max(1, ...series.sampled) * 1.15, [series]);

  const totals = useMemo(() => {
    const sum = (m: Metric, subset: Day[]) =>
      subset.reduce((acc, d) => {
        let s = 0;
        for (const id of langs) s += d[m][id];
        return acc + s;
      }, 0);
    const half = Math.floor(days.length / 2);
    const firstHalf = sum("commits", days.slice(0, half)) || 1;
    const secondHalf = sum("commits", days.slice(days.length - half));
    const commits = sum("commits", days);
    const prs = sum("prs", days);
    const review = days.length ? sum("review", days) / days.length : 0;
    const active = days.filter((d) => [...langs].some((id) => d.commits[id] > 0)).length;
    return {
      commits,
      prs,
      review,
      active,
      delta: Math.round(((secondHalf - firstHalf) / firstHalf) * 100),
    };
  }, [days, langs]);

  const langTotals = useMemo(() => {
    const totalsByLang = LANGUAGES.map((l) => ({
      ...l,
      value: days.reduce((acc, d) => acc + d.commits[l.id], 0),
    }));
    const maxLang = Math.max(1, ...totalsByLang.map((l) => l.value));
    return totalsByLang.map((l) => ({ ...l, share: l.value / maxLang }));
  }, [days]);

  const activity = useMemo(() => {
    const rand = seeded(range * 7 + metric.length);
    const active = LANGUAGES.filter((l) => langs.has(l.id));
    if (!active.length) return [];
    return Array.from({ length: 5 }, (_, i) => {
      const lang = active[Math.floor(rand() * active.length)];
      const repos = REPOS[lang.id];
      const verbs = VERBS[metric];
      return {
        id: `${range}-${metric}-${i}`,
        who: PEOPLE[Math.floor(rand() * PEOPLE.length)],
        verb: verbs[Math.floor(rand() * verbs.length)],
        repo: repos[Math.floor(rand() * repos.length)],
        when: i === 0 ? "just now" : `${Math.round(lerp(4, 55, i / 5) + rand() * 5)}m`,
        color: lang.color,
      };
    });
  }, [langs, metric, range]);

  const toggleLang = (id: LangId) =>
    setLangs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else next.add(id);
      return next;
    });

  const chartW = Math.max(240, width);
  const box = boxFor(chartW);
  const linePath = buildPath(series.sampled, box, max, false);
  const areaPath = buildPath(series.sampled, box, max, true);
  const transition = reduce ? { duration: 0 } : { duration: 0.7, ease: [0.25, 1, 0.5, 1] as const };

  const hoverInfo = (() => {
    if (hover === null) return null;
    const i = clamp(Math.round((hover / chartW) * (series.raw.length - 1)), 0, series.raw.length - 1);
    const innerW = chartW - PAD.left - PAD.right;
    const innerH = CHART_H - PAD.top - PAD.bottom;
    const x = PAD.left + (i / (series.raw.length - 1)) * innerW;
    const v = series.raw[i];
    const y = PAD.top + innerH - (v / max) * innerH;
    const daysAgo = series.raw.length - 1 - i;
    return { x, y, v, label: daysAgo === 0 ? "today" : `${daysAgo}d ago` };
  })();

  const metricMeta = METRICS.find((m) => m.id === metric)!;

  return (
    <div className="flex h-full flex-col gap-5 p-5 text-ink @md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-accent" aria-hidden />
          <span className="text-[13px] font-medium tracking-tight">pulse</span>
          <span className="text-[13px] text-muted">/ web team</span>
        </div>
        <div
          role="tablist"
          aria-label="Range"
          className="relative flex rounded-full border border-line bg-paper p-0.5 text-[12px]"
        >
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
                  layoutId="range-pill"
                  className="absolute inset-0 -z-10 rounded-full bg-ink"
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              {r}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 @lg:grid-cols-4">
        {METRICS.map((m) => {
          const value = m.id === "commits" ? totals.commits : m.id === "prs" ? totals.prs : totals.review;
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
              <div className="mt-1.5 text-[26px] leading-none tracking-tight tnum">
                <AnimatedNumber value={value} decimals={m.id === "review" ? 1 : 0} suffix={m.unit} />
              </div>
            </button>
          );
        })}
        <div className="text-left text-muted">
          <div className="label flex items-center gap-1.5">
            <span className="inline-block h-px w-3 bg-faint" />
            active days
          </div>
          <div className="mt-1.5 text-[26px] leading-none tracking-tight tnum">
            <AnimatedNumber value={totals.active} />
            <span className="ml-1 text-[13px] text-muted">
              / {range}
              <span className={`ml-2 ${totals.delta >= 0 ? "text-[#5b8a72]" : "text-accent"}`}>
                {totals.delta >= 0 ? "+" : ""}
                {totals.delta}%
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 @3xl:grid-cols-[1fr_15rem]">
        <div
          ref={ref}
          className="relative -mx-1 select-none"
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHover(e.clientX - rect.left);
          }}
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
              <linearGradient id="pulse-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((t) => {
              const y = PAD.top + (CHART_H - PAD.top - PAD.bottom) * t;
              return (
                <line key={t} x1={PAD.left} x2={chartW - PAD.right} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 4" />
              );
            })}
            <motion.path d={areaPath} fill="url(#pulse-fill)" animate={{ d: areaPath }} transition={transition} />
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
                <line
                  x1={hoverInfo.x}
                  x2={hoverInfo.x}
                  y1={PAD.top}
                  y2={CHART_H - PAD.bottom}
                  stroke="var(--faint)"
                  strokeWidth={1}
                />
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
                style={{
                  left: clamp(hoverInfo.x, 40, chartW - 40),
                  transform: "translateX(-50%)",
                }}
              >
                <span className="tnum">
                  {metric === "review" ? hoverInfo.v.toFixed(1) + "h" : hoverInfo.v}
                </span>
                <span className="ml-1.5 text-muted">{hoverInfo.label}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <div className="label mb-2.5">by language</div>
            <ul className="space-y-2">
              {langTotals.map((l) => {
                const on = langs.has(l.id);
                return (
                  <li key={l.id}>
                    <button
                      onClick={() => toggleLang(l.id)}
                      aria-pressed={on}
                      className={`group flex w-full items-center gap-3 text-left text-[12px] transition-opacity ${on ? "" : "opacity-40"}`}
                    >
                      <span className="w-[4.5rem] shrink-0 truncate text-ink-2">{l.label}</span>
                      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <motion.span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ backgroundColor: l.color }}
                          animate={{ width: `${Math.round(l.share * 100)}%` }}
                          transition={transition}
                        />
                      </span>
                      <span className="w-8 text-right text-muted tnum">{l.value}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="min-h-0">
            <div className="label mb-2.5">activity</div>
            <ul className="space-y-1.5 text-[12px]">
              <AnimatePresence initial={false} mode="popLayout">
                {activity.map((a) => (
                  <motion.li
                    key={a.id}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex items-baseline gap-2 text-ink-2"
                  >
                    <span className="mt-1 size-1.5 shrink-0 self-center rounded-full" style={{ backgroundColor: a.color }} />
                    <span className="truncate">
                      <span className="text-ink">{a.who}</span> {a.verb} <span className="font-mono text-[11px]">{a.repo}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-muted tnum">{a.when}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
