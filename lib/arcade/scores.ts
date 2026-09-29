/**
 * High scores for the arcade games: the best of all time and the best
 * today, one line each per player. In Upstash each board is a sorted set
 * (`GAME:scores:all`, and `GAME:scores:day:YYYY-MM-DD`, which lets itself
 * go after a couple of days), and a hash of the names people go by. A
 * player is a random secret their browser keeps; boards only ever see a
 * hash of it, so nobody can post as somebody else.
 */

import type { ArcadeGame } from "./games.ts";
import { upstashFromEnv, upstashPipeline, type Command } from "../rooms/store.ts";

/** How many lines a board shows. */
export const BOARD_SIZE = 10;
/** How many of the best of all time are kept; the rest fall off. */
const KEEP = 2000;
const DAY_TTL_SECONDS = 3 * 24 * 60 * 60;

export interface Line {
  /** The hash that stands for a player: enough to spot yourself. */
  who: string;
  name: string;
  score: number;
}

export interface Boards {
  day: string;
  all: Line[];
  today: Line[];
}

/** Where you stand after a run: your bests and places, 1 for first; null for a place off the end. */
export interface Standing {
  best: number;
  rank: number | null;
  todayBest: number;
  todayRank: number | null;
}

export interface ScoreStore {
  /** Keeps a score if it beats the player's best, and says where they stand. */
  submit(game: ArcadeGame, who: string, name: string, score: number, day: string): Promise<Standing>;
  boards(game: ArcadeGame, day: string): Promise<Boards>;
}

/** Today, as boards count it: by the clock in Greenwich. */
export const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** ZREVRANGE … WITHSCORES's flat [member, score, member, score…], in order. */
function ranking(raw: unknown): [string, number][] {
  const out: [string, number][] = [];
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i + 1 < raw.length; i += 2) if (typeof raw[i] === "string") out.push([raw[i], Number(raw[i + 1])]);
  return out;
}

const keys = (game: ArcadeGame, day: string) => ({ all: `${game}:scores:all`, day: `${game}:scores:day:${day}`, names: `${game}:scores:names` });

/* ------------------------------------------------------------- upstash */

export class UpstashScores implements ScoreStore {
  private readonly url: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;

  constructor(url: string, token: string, fetcher: typeof fetch = fetch) {
    this.url = url;
    this.token = token;
    this.fetcher = fetcher;
  }

  private run(commands: Command[]) {
    return upstashPipeline(this.url, this.token, commands, this.fetcher);
  }

  async submit(game: ArcadeGame, who: string, name: string, score: number, day: string): Promise<Standing> {
    const k = keys(game, day);
    const [, , , , , best, rank, todayBest, todayRank] = await this.run([
      // GT: only ever raises someone's score.
      ["ZADD", k.all, "GT", score, who],
      ["ZADD", k.day, "GT", score, who],
      ["HSET", k.names, who, name],
      ["EXPIRE", k.day, DAY_TTL_SECONDS],
      ["ZREMRANGEBYRANK", k.all, 0, -(KEEP + 1)],
      ["ZSCORE", k.all, who],
      ["ZREVRANK", k.all, who],
      ["ZSCORE", k.day, who],
      ["ZREVRANK", k.day, who],
    ]);
    const place = (value: unknown) => (value === null || value === undefined ? null : Number(value) + 1);
    return { best: Number(best ?? score), rank: place(rank), todayBest: Number(todayBest ?? score), todayRank: place(todayRank) };
  }

  async boards(game: ArcadeGame, day: string): Promise<Boards> {
    const k = keys(game, day);
    const [allRaw, todayRaw] = await this.run([
      ["ZREVRANGE", k.all, 0, BOARD_SIZE - 1, "WITHSCORES"],
      ["ZREVRANGE", k.day, 0, BOARD_SIZE - 1, "WITHSCORES"],
    ]);
    const all = ranking(allRaw);
    const today = ranking(todayRaw);
    const who = [...new Set([...all, ...today].map(([id]) => id))];
    const names: Record<string, string> = {};
    if (who.length) {
      const [found] = await this.run([["HMGET", k.names, ...who]]);
      who.forEach((id, i) => (names[id] = Array.isArray(found) && typeof found[i] === "string" ? found[i] : "someone"));
    }
    const lines = (list: [string, number][]) => list.map(([id, score]) => ({ who: id, name: names[id] ?? "someone", score }));
    return { day, all: lines(all), today: lines(today) };
  }
}

/* -------------------------------------------------------------- memory */

/** For trying things out without a database, and for the checks. */
export class MemoryScores implements ScoreStore {
  private readonly sets = new Map<string, Map<string, number>>();
  private readonly names = new Map<string, string>();

  private set(key: string) {
    const found = this.sets.get(key) ?? new Map<string, number>();
    this.sets.set(key, found);
    return found;
  }

  /** Best first; the same score goes the way a sorted set's does, by name backwards. */
  private ranked(key: string): [string, number][] {
    return [...this.set(key).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }

  async submit(game: ArcadeGame, who: string, name: string, score: number, day: string): Promise<Standing> {
    const k = keys(game, day);
    for (const key of [k.all, k.day]) {
      const set = this.set(key);
      if (!set.has(who) || set.get(who)! < score) set.set(who, score);
    }
    this.names.set(`${k.names}:${who}`, name);
    const all = this.ranked(k.all);
    for (const [id] of all.slice(KEEP)) this.set(k.all).delete(id);
    const place = (key: string) => {
      const i = this.ranked(key).findIndex(([id]) => id === who);
      return i < 0 ? null : i + 1;
    };
    return { best: this.set(k.all).get(who) ?? score, rank: place(k.all), todayBest: this.set(k.day).get(who) ?? score, todayRank: place(k.day) };
  }

  async boards(game: ArcadeGame, day: string): Promise<Boards> {
    const k = keys(game, day);
    const lines = (key: string) => this.ranked(key).slice(0, BOARD_SIZE).map(([who, score]) => ({ who, name: this.names.get(`${k.names}:${who}`) ?? "someone", score }));
    return { day, all: lines(k.all), today: lines(k.day) };
  }
}

/* ----------------------------------------------------------------- env */

const globalScores = globalThis as typeof globalThis & { __scores?: MemoryScores };

/** This deployment's boards, or null where there's nowhere to keep them: on Vercel without Upstash. */
export function scoresFromEnv(env: Record<string, string | undefined> = process.env): ScoreStore | null {
  const upstash = upstashFromEnv(env);
  if (upstash) return new UpstashScores(upstash.url, upstash.token);
  if (env.VERCEL) return null;
  return (globalScores.__scores ??= new MemoryScores());
}
