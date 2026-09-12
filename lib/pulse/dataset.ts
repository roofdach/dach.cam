/**
 * The data model behind `pulse`. Demo data and a real GitHub repository are
 * normalised into the same `Dataset`, so every panel is written once and the
 * source becomes a detail rather than a second code path.
 */

import { seeded } from "../random.ts";

export interface Commit {
  ts: number;
  author: string;
  message: string;
  /** Only known for demo data. GitHub would need one request per commit. */
  lang?: string;
}

export interface Pull {
  number: number;
  title: string;
  author: string;
  created: number;
  /** Null while the pull request is still open. */
  merged: number | null;
}

export interface Language {
  name: string;
  value: number;
  color: string;
}

export interface Dataset {
  label: string;
  source: "demo" | "github";
  commits: Commit[];
  pulls: Pull[];
  languages: Language[];
  /** What the numbers in `languages` mean. */
  languageUnit: "bytes" | "commits";
  /** Demo data knows the language of every commit, a real repository doesn't. */
  canFilterByLanguage: boolean;
  /** Shown under the header, e.g. a rate limit warning. */
  note?: string;
}

export const LANGUAGE_COLORS: Record<string, string> = {
  typescript: "#3b6ea5",
  javascript: "#9a8b3f",
  css: "#b7502f",
  html: "#a35a3a",
  rust: "#8a7d5c",
  python: "#5b8a72",
  go: "#4f7f8a",
  ruby: "#8a5c7d",
  java: "#7d6a4f",
  shell: "#6b8a5b",
  c: "#6a7f95",
  "c++": "#6a7f95",
  swift: "#b06a3f",
  kotlin: "#7a5f9a",
  php: "#5f6f9a",
  scss: "#b7502f",
  mdx: "#7a776f",
  markdown: "#7a776f",
};

const FALLBACK_COLORS = ["#3b6ea5", "#5b8a72", "#8a7d5c", "#8a5c7d", "#4f7f8a", "#9a6b3f", "#6b8a5b", "#7a5f9a"];

export function colorForLanguage(name: string, index = 0): string {
  return LANGUAGE_COLORS[name.toLowerCase()] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/* ----------------------------------------------------------------- calendar */

export function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Ascending day boundaries, oldest first, ending with today. Stepping the date
 * rather than subtracting milliseconds keeps it right across a clock change.
 */
export function dayStarts(now: number, days: number): number[] {
  const out: number[] = [];
  const cursor = new Date(startOfDay(now));
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    out.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Counts per day, aligned to `starts`. Anything older is ignored. */
export function bucketByDay(commits: Commit[], starts: number[]): number[] {
  const counts = new Array<number>(starts.length).fill(0);
  if (!starts.length) return counts;
  const first = starts[0];
  for (const commit of commits) {
    if (commit.ts < first) continue;
    // Days are short lists, and walking back from the end is the common case.
    let i = starts.length - 1;
    while (i > 0 && commit.ts < starts[i]) i--;
    counts[i]++;
  }
  return counts;
}

export function hourHistogram(commits: Commit[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const commit of commits) hours[new Date(commit.ts).getHours()]++;
  return hours;
}

export function weekdayHistogram(commits: Commit[]): number[] {
  const days = new Array<number>(7).fill(0);
  // Monday first: a working week reads better than a calendar one here.
  for (const commit of commits) days[(new Date(commit.ts).getDay() + 6) % 7]++;
  return days;
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/* -------------------------------------------------------------- aggregation */

export interface Contributor {
  name: string;
  commits: number;
  /** Merged pull requests in the same window. */
  pulls: number;
  share: number;
}

export function contributors(commits: Commit[], pulls: Pull[]): Contributor[] {
  const counts = new Map<string, number>();
  for (const commit of commits) counts.set(commit.author, (counts.get(commit.author) ?? 0) + 1);
  const merged = new Map<string, number>();
  for (const pull of pulls) {
    if (pull.merged) merged.set(pull.author, (merged.get(pull.author) ?? 0) + 1);
  }
  const top = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .map(([name, value]) => ({ name, commits: value, pulls: merged.get(name) ?? 0, share: value / top }))
    .sort((a, b) => b.commits - a.commits);
}

export function languagesFromCommits(commits: Commit[]): Language[] {
  const counts = new Map<string, number>();
  for (const commit of commits) {
    if (!commit.lang) continue;
    counts.set(commit.lang, (counts.get(commit.lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name, value, color: colorForLanguage(name, i) }));
}

/** Hours from opening a pull request to merging it. Open ones are skipped. */
export function reviewLatencies(pulls: Pull[]): number[] {
  return pulls
    .filter((p) => p.merged !== null)
    .map((p) => (p.merged! - p.created) / 3_600_000)
    .filter((hours) => hours >= 0)
    .sort((a, b) => a - b);
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export interface Bin {
  label: string;
  from: number;
  to: number;
  count: number;
}

/** Buckets that match how people actually talk about review time. */
export const LATENCY_BINS: [string, number, number][] = [
  ["<1h", 0, 1],
  ["1–4h", 1, 4],
  ["4–12h", 4, 12],
  ["12–24h", 12, 24],
  ["1–3d", 24, 72],
  [">3d", 72, Infinity],
];

export function latencyHistogram(latencies: number[]): Bin[] {
  return LATENCY_BINS.map(([label, from, to]) => ({
    label,
    from,
    to,
    count: latencies.filter((h) => h >= from && h < to).length,
  }));
}

export interface Window {
  commits: Commit[];
  pulls: Pull[];
  starts: number[];
}

/** Everything inside the last `days` days, plus the calendar that fits it. */
export function windowOf(dataset: Dataset, days: number, now: number): Window {
  const starts = dayStarts(now, days);
  const from = starts[0];
  return {
    starts,
    commits: dataset.commits.filter((c) => c.ts >= from),
    pulls: dataset.pulls.filter((p) => p.created >= from || (p.merged ?? 0) >= from),
  };
}

/** Percentage change between the two halves of the window. */
export function trend(counts: number[]): number {
  const half = Math.floor(counts.length / 2);
  if (!half) return 0;
  const before = counts.slice(0, half).reduce((a, b) => a + b, 0);
  const after = counts.slice(counts.length - half).reduce((a, b) => a + b, 0);
  if (!before) return after ? 100 : 0;
  return Math.round(((after - before) / before) * 100);
}

/* --------------------------------------------------------------------- demo */

const PEOPLE = [
  { name: "mara", weight: 0.3 },
  { name: "jules", weight: 0.24 },
  { name: "iko", weight: 0.18 },
  { name: "sam", weight: 0.14 },
  { name: "ren", weight: 0.09 },
  { name: "theo", weight: 0.05 },
];

const DEMO_LANGUAGES = [
  { name: "typescript", weight: 0.5 },
  { name: "css", weight: 0.2 },
  { name: "rust", weight: 0.17 },
  { name: "python", weight: 0.13 },
];

const SUBJECTS = [
  "the presence layer",
  "the range picker",
  "cursor interpolation",
  "the empty state",
  "the retry backoff",
  "the indexer",
  "the colour tokens",
  "keyboard navigation",
  "the migration script",
  "the cache key",
];

const VERBS = ["fix", "simplify", "rewrite", "tidy up", "speed up", "document", "split out", "revert"];

function pickWeighted<T extends { weight: number }>(items: T[], r: number): T {
  let acc = 0;
  for (const item of items) {
    acc += item.weight;
    if (r <= acc) return item;
  }
  return items[items.length - 1];
}

/**
 * 90 days of plausible history. Deterministic, so the same day always produces
 * the same numbers and nothing flickers between renders.
 */
export function buildDemo(now: number): Dataset {
  const rand = seeded(42);
  const starts = dayStarts(now, 90);
  const commits: Commit[] = [];
  const pulls: Pull[] = [];
  let pullNumber = 812;

  starts.forEach((dayStart, index) => {
    const weekday = new Date(dayStart).getDay();
    const weekend = weekday === 0 || weekday === 6;
    if (weekend && rand() < 0.55) return;

    const drift = 0.75 + 0.5 * Math.sin(index / 11) + 0.25 * Math.sin(index / 3.7);
    const count = Math.max(0, Math.round((4 + drift * 6) * (weekend ? 0.35 : 1) + rand() * 5));

    for (let i = 0; i < count; i++) {
      // Two humps: late morning and late evening.
      const hour = rand() < 0.55 ? 9 + Math.floor(rand() * 4) : 19 + Math.floor(rand() * 5);
      const ts = dayStart + hour * 3_600_000 + Math.floor(rand() * 3_600_000);
      if (ts > now) continue;
      commits.push({
        ts,
        author: pickWeighted(PEOPLE, rand()).name,
        lang: pickWeighted(DEMO_LANGUAGES, rand()).name,
        message: `${VERBS[Math.floor(rand() * VERBS.length)]} ${SUBJECTS[Math.floor(rand() * SUBJECTS.length)]}`,
      });
    }

    const opened = rand() < 0.75 ? 1 + Math.floor(rand() * 2) : 0;
    for (let i = 0; i < opened; i++) {
      const created = dayStart + Math.floor(rand() * 10 + 9) * 3_600_000;
      if (created > now) continue;
      // Most reviews land the same day; a few drag on for days.
      const hours = rand() < 0.72 ? 0.4 + rand() * 9 : 20 + rand() * 90;
      const merged = created + hours * 3_600_000;
      pulls.push({
        number: pullNumber++,
        title: `${VERBS[Math.floor(rand() * VERBS.length)]} ${SUBJECTS[Math.floor(rand() * SUBJECTS.length)]}`,
        author: pickWeighted(PEOPLE, rand()).name,
        created,
        merged: merged > now ? null : merged,
      });
    }
  });

  commits.sort((a, b) => b.ts - a.ts);
  pulls.sort((a, b) => b.created - a.created);

  return {
    label: "web team · demo data",
    source: "demo",
    commits,
    pulls,
    languages: languagesFromCommits(commits),
    languageUnit: "commits",
    canFilterByLanguage: true,
  };
}
