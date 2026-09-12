/**
 * The conversions behind `snip`. Everything here is pure and framework-free:
 * a string plus options goes in, a `Result` comes out. The homepage preview and
 * the full app both call `run`, so there is only one implementation of each
 * conversion to get wrong.
 */

export type ToolId = "json" | "base64" | "url" | "color" | "hash" | "jwt" | "time" | "text";

export interface Field {
  label: string;
  value: string;
}

export interface Table {
  caption: string;
  rows: Field[];
}

export type Result =
  | {
      ok: true;
      /** The main body, shown in the output pane and copied by the copy button. */
      output: string;
      /** Short key/value facts shown under the output. */
      extra?: Field[];
      /** A colour to render as a swatch instead of plain text. */
      swatch?: string;
      /** A longer key/value listing, e.g. query parameters or jwt claims. */
      table?: Table;
      /** A perceptual light-to-dark ramp, only used by the colour tool. */
      ramp?: string[];
      /** Shown when the result is correct but worth a caveat. */
      hint?: string;
    }
  | { ok: false; error: string };

export interface ToolOptions {
  /** json: spaces per level, 0 for minified. */
  indent: number;
  /** base64 / url: which direction to convert. */
  mode: "encode" | "decode";
  /** json: sort object keys recursively. */
  sortKeys: boolean;
  /** base64: use the url-safe alphabet. */
  urlSafe: boolean;
  /** hash: which digest to use. */
  algorithm: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
}

export const DEFAULT_OPTIONS: ToolOptions = {
  indent: 2,
  mode: "encode",
  sortKeys: false,
  urlSafe: false,
  algorithm: "SHA-256",
};

export const TOOLS: { id: ToolId; label: string; blurb: string; placeholder: string }[] = [
  {
    id: "json",
    label: "json",
    blurb: "format, minify, sort keys, and point at the character that broke it",
    placeholder: '{"name":"snip","tags":["small","fast"],"nested":{"ok":true}}',
  },
  { id: "base64", label: "base64", blurb: "encode and decode, standard or url-safe", placeholder: "the quick brown fox" },
  {
    id: "url",
    label: "url",
    blurb: "encode and decode, and pull a url apart into its query parameters",
    placeholder: "https://example.com/search?q=hello world&lang=en ie",
  },
  {
    id: "color",
    label: "colour",
    blurb: "hex, rgb, hsl and oklch, with contrast ratios and a perceptual ramp",
    placeholder: "#b7502f",
  },
  { id: "hash", label: "hash", blurb: "sha-1 through sha-512, done in the browser", placeholder: "hash me" },
  { id: "jwt", label: "jwt", blurb: "decode the header and claims. no signature checking", placeholder: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwibmFtZSI6ImRhY2gifQ.c2ln" },
  { id: "time", label: "time", blurb: "epoch to iso to human, in your timezone and utc", placeholder: "1767225600" },
  { id: "text", label: "text", blurb: "counts, and the four cases you keep converting between", placeholder: "the quick brown fox" },
];

/* ------------------------------------------------------------------ base64 */

export function toBase64(input: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const out = btoa(binary);
  return urlSafe ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
}

export function fromBase64(input: string): string {
  const normalised = input.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/* ------------------------------------------------------------------- colour */

import { buildRamp, contrastRatio, parseColor, rgbToHsl, rgbToOklch, toHex } from "../color.ts";

export {
  buildRamp,
  contrastRatio,
  hslToRgb,
  oklchToRgb,
  parseColor,
  relativeLuminance,
  rgbToHsl,
  rgbToOklch,
  toHex,
  type Rgb,
} from "../color.ts";

/* --------------------------------------------------------------------- text */

const words = (s: string) => s.split(/[\s_\-.]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);

export const toCamel = (s: string) =>
  words(s)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
export const toPascal = (s: string) => words(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
export const toSnake = (s: string) => words(s).map((w) => w.toLowerCase()).join("_");
export const toKebab = (s: string) => words(s).map((w) => w.toLowerCase()).join("-");
export const toTitle = (s: string) => words(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
export const toSlug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/* --------------------------------------------------------------------- json */

/**
 * Engines describe a bad parse in three different ways: with a position and a
 * line/column, with a position only, or with the whole input quoted back at you
 * and no position at all. Turn all three into one short sentence.
 */
function jsonErrorDetail(message: string, input: string): string {
  const lineColumn = message.match(/\(line (\d+) column (\d+)\)/);
  const position = message.match(/position (\d+)/);
  const reason =
    message
      .replace(/\s*in JSON at position[\s\S]*$/, "")
      .replace(/,?\s*"[\s\S]*"\s*is not valid JSON\.?$/, "")
      .replace(/^JSON\.parse:\s*/, "")
      .trim()
      .toLowerCase() || "that isn't valid json";

  if (lineColumn) return `${reason} — line ${lineColumn[1]}, column ${lineColumn[2]}`;
  if (position) {
    const at = Math.min(+position[1], input.length);
    const before = input.slice(0, at);
    return `${reason} — line ${before.split("\n").length}, column ${at - before.lastIndexOf("\n")}`;
  }
  return reason;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortDeep(v)]),
    );
  }
  return value;
}

function depthOf(value: unknown, level = 1): number {
  if (!value || typeof value !== "object") return level;
  const children = Object.values(value as Record<string, unknown>);
  if (!children.length) return level;
  return Math.max(...children.map((c) => depthOf(c, level + 1)));
}

function countNodes(value: unknown): number {
  if (!value || typeof value !== "object") return 1;
  return 1 + Object.values(value as Record<string, unknown>).reduce<number>((n, c) => n + countNodes(c), 0);
}

/* ---------------------------------------------------------------------- jwt */

function decodeJwtSegment(segment: string): unknown {
  return JSON.parse(fromBase64(segment));
}

const JWT_TIME_CLAIMS = new Set(["exp", "iat", "nbf", "auth_time", "updated_at"]);

/* --------------------------------------------------------------------- time */

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000000],
  ["month", 2592000000],
  ["week", 604800000],
  ["day", 86400000],
  ["hour", 3600000],
  ["minute", 60000],
  ["second", 1000],
];

export function relativeTime(from: number, to: number): string {
  const diff = from - to;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms || unit === "second") return format.format(Math.round(diff / ms), unit);
  }
  return "now";
}

export function parseTime(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d{1,19}$/.test(s)) {
    const n = Number(s);
    // Seconds, milliseconds and microseconds all get typed into these boxes.
    const ms = s.length <= 11 ? n * 1000 : s.length <= 14 ? n : Math.floor(n / 1000);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* ---------------------------------------------------------------------- run */

const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * Every tool except `hash`, which needs `crypto.subtle` and therefore a promise.
 * Returning a plain value keeps callers able to run this during render.
 */
export function run(tool: ToolId, input: string, options: ToolOptions = DEFAULT_OPTIONS): Result {
  if (!input.trim()) return { ok: true, output: "" };

  try {
    switch (tool) {
      case "json": {
        const parsed: unknown = JSON.parse(input);
        const value = options.sortKeys ? sortDeep(parsed) : parsed;
        const output = JSON.stringify(value, null, options.indent === 0 ? undefined : options.indent) ?? "";
        const shape = Array.isArray(parsed)
          ? `array · ${parsed.length} items`
          : parsed && typeof parsed === "object"
            ? `object · ${Object.keys(parsed).length} keys`
            : typeof parsed;
        return {
          ok: true,
          output,
          extra: [
            { label: "type", value: shape },
            { label: "nodes", value: String(countNodes(parsed)) },
            { label: "depth", value: String(depthOf(parsed)) },
            { label: "size", value: `${bytes(output)} bytes` },
          ],
        };
      }

      case "base64": {
        if (options.mode === "encode") {
          const output = toBase64(input, options.urlSafe);
          return {
            ok: true,
            output,
            extra: [
              { label: "in", value: `${bytes(input)} bytes` },
              { label: "out", value: `${output.length} chars` },
              { label: "alphabet", value: options.urlSafe ? "url-safe" : "standard" },
            ],
          };
        }
        const output = fromBase64(input);
        return { ok: true, output, extra: [{ label: "out", value: `${bytes(output)} bytes` }] };
      }

      case "url": {
        const output =
          options.mode === "encode" ? encodeURIComponent(input) : decodeURIComponent(input.trim().replace(/\+/g, " "));
        let table: Table | undefined;
        try {
          const url = new URL(input.trim());
          const rows: Field[] = [
            { label: "protocol", value: url.protocol.replace(":", "") },
            { label: "host", value: url.host },
            { label: "path", value: url.pathname },
            ...[...url.searchParams].map(([label, value]) => ({ label, value })),
          ];
          if (url.hash) rows.push({ label: "hash", value: url.hash.slice(1) });
          table = { caption: "parsed", rows };
        } catch {
          // Not a whole url, which is fine: it was probably just a fragment.
        }
        return { ok: true, output, table };
      }

      case "color": {
        const rgb = parseColor(input);
        if (!rgb) return { ok: false, error: "couldn't read that as a colour. try #hex, rgb(), hsl(), oklch() or a name." };
        const hex = toHex(rgb);
        const hsl = rgbToHsl(rgb);
        const oklch = rgbToOklch(rgb);
        const onWhite = contrastRatio(rgb, { r: 255, g: 255, b: 255 });
        const onBlack = contrastRatio(rgb, { r: 0, g: 0, b: 0 });
        const grade = (ratio: number) => (ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "fails");
        return {
          ok: true,
          output: hex,
          swatch: hex,
          ramp: buildRamp(rgb),
          extra: [
            { label: "hex", value: hex },
            { label: "rgb", value: `rgb(${rgb.r} ${rgb.g} ${rgb.b})` },
            { label: "hsl", value: `hsl(${hsl.h} ${hsl.s}% ${hsl.l}%)` },
            { label: "oklch", value: `oklch(${(oklch.l * 100).toFixed(1)}% ${oklch.c.toFixed(3)} ${oklch.h.toFixed(1)})` },
            { label: "on white", value: `${onWhite.toFixed(2)}:1 · ${grade(onWhite)}` },
            { label: "on black", value: `${onBlack.toFixed(2)}:1 · ${grade(onBlack)}` },
          ],
        };
      }

      case "jwt": {
        const parts = input.trim().split(".");
        if (parts.length < 2) return { ok: false, error: "a jwt has at least two dot-separated parts." };
        const header = decodeJwtSegment(parts[0]) as Record<string, unknown>;
        const payload = decodeJwtSegment(parts[1]) as Record<string, unknown>;
        const rows: Field[] = Object.entries(payload).map(([label, value]) => {
          if (JWT_TIME_CLAIMS.has(label) && typeof value === "number") {
            const date = new Date(value * 1000);
            return { label, value: `${value} · ${date.toISOString().replace(".000", "")}` };
          }
          return { label, value: typeof value === "object" ? JSON.stringify(value) : String(value) };
        });
        const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null;
        return {
          ok: true,
          output: JSON.stringify({ header, payload }, null, 2),
          table: { caption: "claims", rows },
          extra: [
            { label: "alg", value: String(header.alg ?? "—") },
            { label: "typ", value: String(header.typ ?? "—") },
            ...(exp ? [{ label: "status", value: exp < Date.now() ? "expired" : "still valid" }] : []),
            { label: "signature", value: parts[2] ? `${parts[2].length} chars, not checked` : "missing" },
          ],
          hint: "decoded only. anyone can read a jwt, so never put anything secret in one.",
        };
      }

      case "time": {
        const date = parseTime(input);
        if (!date) return { ok: false, error: "couldn't read that as a time. try an epoch or an iso string." };
        const ms = date.getTime();
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const local = new Intl.DateTimeFormat("en-GB", {
          dateStyle: "full",
          timeStyle: "long",
        }).format(date);
        return {
          ok: true,
          output: date.toISOString(),
          extra: [
            { label: "iso", value: date.toISOString() },
            { label: "local", value: local },
            { label: "zone", value: zone },
            { label: "unix s", value: String(Math.floor(ms / 1000)) },
            { label: "unix ms", value: String(ms) },
            { label: "relative", value: relativeTime(ms, Date.now()) },
          ],
        };
      }

      case "text": {
        const lines = input.split("\n");
        const wordCount = input.trim() ? input.trim().split(/\s+/).length : 0;
        return {
          ok: true,
          output: input,
          extra: [
            { label: "characters", value: String([...input].length) },
            { label: "words", value: String(wordCount) },
            { label: "lines", value: String(lines.length) },
            { label: "bytes", value: String(bytes(input)) },
          ],
          table: {
            caption: "cases",
            rows: [
              { label: "camelCase", value: toCamel(input) },
              { label: "PascalCase", value: toPascal(input) },
              { label: "snake_case", value: toSnake(input) },
              { label: "kebab-case", value: toKebab(input) },
              { label: "Title Case", value: toTitle(input) },
              { label: "slug", value: toSlug(input) },
              { label: "UPPER", value: input.toUpperCase() },
              { label: "lower", value: input.toLowerCase() },
            ],
          },
        };
      }

      case "hash":
        return { ok: true, output: "", hint: "hashing…" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "something went wrong";
    if (tool === "json") return { ok: false, error: jsonErrorDetail(message, input) };
    if (tool === "base64") return { ok: false, error: "that isn't valid base64." };
    if (tool === "jwt") return { ok: false, error: "couldn't decode that jwt. the header or payload isn't valid base64url json." };
    if (tool === "url") return { ok: false, error: "that has an invalid percent-escape in it." };
    return { ok: false, error: message.toLowerCase() };
  }
}

/** Separate because digests are async. Same `Result` shape as everything else. */
export async function runHash(input: string, algorithm: ToolOptions["algorithm"]): Promise<Result> {
  if (!input) return { ok: true, output: "" };
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    ok: true,
    output: hex,
    extra: [
      { label: "algorithm", value: algorithm.toLowerCase() },
      { label: "length", value: `${hex.length * 4} bits` },
      { label: "input", value: `${bytes(input)} bytes` },
    ],
    hint: algorithm === "SHA-1" ? "sha-1 is broken for signatures. fine for cache keys, not for security." : undefined,
  };
}
