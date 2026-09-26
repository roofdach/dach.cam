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
  const ttls = new Map<string, number>();
  const commands: string[][] = [];
  const exists = (key: string) => strings.has(key) || lists.has(key) || hashes.has(key);
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
          if (strings.delete(k) || lists.delete(k) || hashes.delete(k)) n++;
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
  return { url, lists, hashes, ttls, commands, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
