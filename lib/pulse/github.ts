/**
 * Optional live data for `pulse`. Reads a public repository straight from the
 * browser using GitHub's unauthenticated api, which allows 60 requests an hour
 * per address. One repository costs about six of them.
 */

import { colorForLanguage, type Commit, type Dataset, type Language, type Pull } from "./dataset.ts";

export interface Repo {
  owner: string;
  name: string;
}

/** Accepts `owner/name`, a github url, or `github.com/owner/name`. */
export function parseRepo(input: string): Repo | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const match = cleaned.match(/^([\w.-]+)\/([\w.-]+)/);
  if (!match) return null;
  return { owner: match[1], name: match[2] };
}

export class GitHubError extends Error {}

interface GitHubCommit {
  commit: { message: string; author: { name?: string; date?: string } | null };
  author: { login: string } | null;
}

interface GitHubPull {
  number: number;
  title: string;
  user: { login: string } | null;
  created_at: string;
  merged_at: string | null;
}

interface GitHubRepo {
  full_name: string;
  stargazers_count: number;
  pushed_at: string;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/vnd.github+json" },
  });

  if (response.ok) return (await response.json()) as T;

  if (response.status === 404) {
    throw new GitHubError("no public repository with that name. check the owner and the spelling.");
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (remaining === "0" && reset) {
      const minutes = Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60_000));
      throw new GitHubError(
        `github's anonymous rate limit is spent. it resets in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }
    throw new GitHubError("github refused that request. the repository may be private.");
  }
  if (response.status === 409) {
    throw new GitHubError("that repository is empty, so there is nothing to chart.");
  }
  throw new GitHubError(`github answered ${response.status}. try again in a moment.`);
}

const API = "https://api.github.com/repos";
const COMMIT_PAGES = 3;

export async function loadRepo(input: string, signal?: AbortSignal): Promise<Dataset> {
  const repo = parseRepo(input);
  if (!repo) throw new GitHubError("write it as owner/name, for example vercel/next.js.");

  const base = `${API}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const meta = await getJson<GitHubRepo>(base, signal);

  const [pages, languageBytes, pullList] = await Promise.all([
    Promise.all(
      Array.from({ length: COMMIT_PAGES }, (_, i) =>
        getJson<GitHubCommit[]>(`${base}/commits?per_page=100&page=${i + 1}`, signal).catch(() => [] as GitHubCommit[]),
      ),
    ),
    getJson<Record<string, number>>(`${base}/languages`, signal).catch(() => ({}) as Record<string, number>),
    getJson<GitHubPull[]>(`${base}/pulls?state=all&sort=created&direction=desc&per_page=100`, signal).catch(
      () => [] as GitHubPull[],
    ),
  ]);

  const commits: Commit[] = pages
    .flat()
    .map((entry) => ({
      ts: Date.parse(entry.commit.author?.date ?? ""),
      author: entry.author?.login ?? entry.commit.author?.name ?? "unknown",
      message: entry.commit.message.split("\n")[0],
    }))
    .filter((commit) => Number.isFinite(commit.ts))
    .sort((a, b) => b.ts - a.ts);

  if (!commits.length) throw new GitHubError("that repository has no commits this api will show.");

  const pulls: Pull[] = pullList
    .map((entry) => ({
      number: entry.number,
      title: entry.title,
      author: entry.user?.login ?? "unknown",
      created: Date.parse(entry.created_at),
      merged: entry.merged_at ? Date.parse(entry.merged_at) : null,
    }))
    .filter((pull) => Number.isFinite(pull.created));

  const languages: Language[] = Object.entries(languageBytes)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name: name.toLowerCase(), value, color: colorForLanguage(name, i) }));

  const oldest = commits[commits.length - 1].ts;
  const span = Math.max(1, Math.round((Date.now() - oldest) / 86_400_000));

  return {
    label: meta.full_name,
    source: "github",
    commits,
    pulls,
    languages,
    languageUnit: "bytes",
    canFilterByLanguage: false,
    note:
      commits.length >= COMMIT_PAGES * 100
        ? `the api hands over the last ${commits.length} commits, which here covers about ${span} days.`
        : `${commits.length} commits, going back about ${span} days.`,
  };
}
