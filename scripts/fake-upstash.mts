/**
 * A pretend Upstash for the checks: the REST protocol (POST /pipeline, a
 * bearer token, an array of {result} or {error} back) over a tiny in-memory
 * Redis with just the commands the rooms use.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export async function fakeUpstash(token: string) {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, string>>();
  const zsets = new Map<string, Map<string, number>>();
  const ttls = new Map<string, number>();
  const commands: string[][] = [];
  const exists = (key: string) => strings.has(key) || lists.has(key) || hashes.has(key) || zsets.has(key);
  /** A sorted set best first, as ZREVRANGE has it: by score, then by member backwards. */
  const ranked = (key: string) => [...(zsets.get(key) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  const run = (command: string[]): unknown => {
    const [name, key, ...args] = command;
    switch (name.toUpperCase()) {
      case "SET": {
        const nx = args.some((a) => a.toUpperCase() === "NX");
        if (nx && exists(key)) return null;
        strings.set(key, args[0]);
        const ex = args.findIndex((a) => a.toUpperCase() === "EX");
        if (ex >= 0) ttls.set(key, Number(args[ex + 1]));
        return "OK";
      }
      case "DEL": {
        let n = 0;
        for (const k of [key, ...args]) {
          if (strings.delete(k) || lists.delete(k) || hashes.delete(k) || zsets.delete(k)) n++;
        }
        return n;
      }
      case "RPUSH": {
        if (strings.has(key)) throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        const list = lists.get(key) ?? [];
        list.push(...args);
        lists.set(key, list);
        return list.length;
      }
      case "LRANGE": {
        const list = lists.get(key) ?? [];
        const start = Number(args[0]);
        const stop = Number(args[1]);
        return list.slice(start, stop === -1 ? undefined : stop + 1);
      }
      case "LINDEX": {
        const list = lists.get(key) ?? [];
        const i = Number(args[0]);
        return list[i < 0 ? list.length + i : i] ?? null;
      }
      case "HSET": {
        const hash = hashes.get(key) ?? new Map<string, string>();
        let added = 0;
        for (let i = 0; i < args.length; i += 2) {
          if (!hash.has(args[i])) added++;
          hash.set(args[i], args[i + 1]);
        }
        hashes.set(key, hash);
        return added;
      }
      case "HMGET": {
        const hash = hashes.get(key);
        return args.map((field) => hash?.get(field) ?? null);
      }
      case "ZADD": {
        const gt = args[0]?.toUpperCase() === "GT";
        const rest = gt ? args.slice(1) : args;
        const set = zsets.get(key) ?? new Map<string, number>();
        let added = 0;
        for (let i = 0; i + 1 < rest.length; i += 2) {
          const score = Number(rest[i]);
          const member = rest[i + 1];
          if (!set.has(member)) added++;
          if (!set.has(member) || !gt || score > set.get(member)!) set.set(member, score);
        }
        zsets.set(key, set);
        return added;
      }
      case "ZSCORE": {
        const score = zsets.get(key)?.get(args[0]);
        return score === undefined ? null : String(score);
      }
      case "ZREVRANK": {
        const i = ranked(key).findIndex(([member]) => member === args[0]);
        return i < 0 ? null : i;
      }
      case "ZREVRANGE": {
        const list = ranked(key);
        const stop = Number(args[1]);
        const slice = list.slice(Number(args[0]), stop < 0 ? list.length + stop + 1 : stop + 1);
        return args[2]?.toUpperCase() === "WITHSCORES" ? slice.flatMap(([m, score]) => [m, String(score)]) : slice.map(([m]) => m);
      }
      case "ZREMRANGEBYRANK": {
        // Ranks count from the lowest score up.
        const list = ranked(key).reverse();
        const n = list.length;
        const start = Number(args[0]) < 0 ? n + Number(args[0]) : Number(args[0]);
        const stop = Number(args[1]) < 0 ? n + Number(args[1]) : Number(args[1]);
        let removed = 0;
        for (let i = Math.max(0, start); i <= Math.min(n - 1, stop); i++) {
          zsets.get(key)!.delete(list[i][0]);
          removed++;
        }
        return removed;
      }
      case "HGETALL":
        return [...(hashes.get(key) ?? new Map()).entries()].flat();
      case "EXPIRE":
        if (!exists(key)) return 0;
        ttls.set(key, Number(args[0]));
        return 1;
      default:
        throw new Error(`ERR unknown command '${name}'`);
    }
  };
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.headers.authorization !== `Bearer ${token}`) return reply(401, { error: "Unauthorized" });
      if (request.method !== "POST" || request.url !== "/pipeline") return reply(404, { error: "Not found" });
      const batch = JSON.parse(raw) as unknown[];
      for (const command of batch) {
        if (!Array.isArray(command) || !command.every((part) => typeof part === "string")) {
          return reply(400, { error: "ERR every part of a command must be a string" });
        }
      }
      reply(
        200,
        (batch as string[][]).map((command) => {
          commands.push(command);
          try {
            return { result: run(command) };
          } catch (error) {
            return { error: (error as Error).message };
          }
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, lists, hashes, zsets, ttls, commands, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
