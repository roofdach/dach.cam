/**
 * One runnable check for the logic behind the four projects. No framework:
 * `npm run check` either prints a list of ticks or throws.
 *
 * Anything that needs a canvas, a DOM or a network is left to the browser;
 * what is here is the part that would be silently wrong.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Script } from "node:vm";

import { Doc, diffText, keyBetween, keysBetween, type Op } from "../lib/together/doc.ts";
import {
  DEFAULT_OPTIONS,
  buildRamp,
  fromBase64,
  parseColor,
  rgbToHsl,
  rgbToOklch,
  oklchToRgb,
  run,
  runHash,
  toBase64,
  contrastRatio,
} from "../lib/snip/tools.ts";
import { DEFAULT_SETTINGS, createState, gridFor, sampleField } from "../lib/field/sim.ts";
import { checkFont, textMask } from "../lib/field/text.ts";
import { toHtml, toReact } from "../lib/field/export.ts";
import { fieldToSvg } from "../lib/field/svg.ts";
import { labelForHost, previewSvg } from "../lib/field/preview-image.ts";
import { clampChroma, inGamut } from "../lib/color.ts";
import { STEPS, buildScale, serialise } from "../lib/palette/scale.ts";
import { requestOrigin } from "../lib/origin.ts";
import { ACCENT_SCRIPT, isAccent } from "../lib/accent.ts";
import {
  bucketByDay,
  buildDemo,
  contributors,
  dayStarts,
  latencyHistogram,
  quantile,
  reviewLatencies,
  trend,
  weekdayHistogram,
} from "../lib/pulse/dataset.ts";
import { buildPath, resample, smooth } from "../lib/pulse/chart.ts";
import { parseRepo } from "../lib/pulse/github.ts";

const results: string[] = [];
async function check(name: string, body: () => void | Promise<void>) {
  await body();
  results.push(name);
}

/* --------------------------------------------------------------- together */

await check("fractional keys stay ordered under repeated splitting", () => {
  const keys = [keyBetween(null, null)];
  for (let round = 0; round < 400; round++) {
    const at = Math.floor(Math.random() * (keys.length + 1));
    const left = at > 0 ? keys[at - 1] : null;
    const right = at < keys.length ? keys[at] : null;
    const key = keyBetween(left, right);
    if (left !== null) assert.ok(left < key, `${left} < ${key}`);
    if (right !== null) assert.ok(key < right, `${key} < ${right}`);
    keys.splice(at, 0, key);
  }
  assert.deepEqual(keys, [...keys].sort(), "keys must already be in order");
  assert.equal(new Set(keys).size, keys.length, "keys must be unique");
  assert.ok(keys.every((k) => !k.endsWith("0")), "no key may end in the lowest digit");
});

await check("keysBetween hands back an ascending run", () => {
  const run = keysBetween("1", "2", 5);
  assert.equal(run.length, 5);
  assert.deepEqual(run, [...run].sort());
  assert.ok(run.every((k) => k > "1" && k < "2"));
});

await check("diffText finds the smallest single change", () => {
  assert.equal(diffText("abc", "abc"), null);
  assert.deepEqual(diffText("abc", "abXc"), { index: 2, removed: 0, inserted: "X" });
  assert.deepEqual(diffText("abc", "ac"), { index: 1, removed: 1, inserted: "" });
  assert.deepEqual(diffText("", "hi"), { index: 0, removed: 0, inserted: "hi" });
  assert.deepEqual(diffText("hi", ""), { index: 0, removed: 2, inserted: "" });
});

await check("an edit leaves the document holding exactly what was typed", () => {
  const doc = new Doc("a");
  let text = "";
  for (const next of ["hello", "hello world", "hell world", "hell, world!", "", "back again"]) {
    doc.edit(text, next);
    assert.equal(doc.text(), next);
    text = next;
  }
});

await check("two documents converge after concurrent edits", () => {
  const seed = (() => {
    const d = new Doc("seed");
    d.insertAt(0, "the quick brown fox");
    return d.ops();
  })();

  for (let round = 0; round < 60; round++) {
    const a = new Doc("a");
    const b = new Doc("b");
    a.applyAll(seed);
    b.applyAll(seed);

    const pending: { from: Doc; to: Doc; ops: Op[] }[] = [];
    for (let turn = 0; turn < 8; turn++) {
      const [doc, other] = Math.random() < 0.5 ? [a, b] : [b, a];
      const at = Math.floor(Math.random() * (doc.length + 1));
      const ops =
        Math.random() < 0.6
          ? doc.insertAt(at, Math.random().toString(36).slice(2, 5))
          : doc.deleteAt(at, 1 + Math.floor(Math.random() * 3));
      if (ops.length) pending.push({ from: doc, to: other, ops });
    }

    // Deliver out of order, and twice, to prove ops are idempotent.
    for (const delivery of [...pending].sort(() => Math.random() - 0.5)) delivery.to.applyAll(delivery.ops);
    for (const delivery of pending) delivery.to.applyAll(delivery.ops);

    assert.equal(a.text(), b.text(), `round ${round}`);
  }
});

await check("a delete arriving before its insert still removes the character", () => {
  const a = new Doc("a");
  const b = new Doc("b");
  const insert = a.insertAt(0, "x");
  const remove = a.deleteAt(0, 1);
  b.applyAll(remove);
  b.applyAll(insert);
  assert.equal(b.text(), "");
  assert.equal(a.text(), "");
});

/* ------------------------------------------------------------------- snip */

await check("base64 survives a round trip, including non-ascii", () => {
  for (const value of ["the quick brown fox", "héllo wörld", "🌍 ok", ""]) {
    assert.equal(fromBase64(toBase64(value)), value);
    assert.equal(fromBase64(toBase64(value, true)), value, "url-safe alphabet");
  }
  assert.equal(toBase64("hi"), "aGk=");
  assert.equal(toBase64("hi", true), "aGk");
});

await check("colours parse from every notation and come back the same", () => {
  const orange = parseColor("#b7502f")!;
  assert.deepEqual(orange, { r: 183, g: 80, b: 47 });
  assert.deepEqual(parseColor("#b52"), { r: 187, g: 85, b: 34 });
  assert.deepEqual(parseColor("rgb(183 80 47)"), orange);
  assert.deepEqual(parseColor("red"), { r: 255, g: 0, b: 0 });
  assert.equal(parseColor("not a colour"), null);

  // hsl is displayed rounded to whole numbers, so the trip back lands within a step.
  const hsl = rgbToHsl(orange);
  const viaHsl = parseColor(`hsl(${hsl.h} ${hsl.s}% ${hsl.l}%)`)!;
  for (const key of ["r", "g", "b"] as const) {
    assert.ok(Math.abs(viaHsl[key] - orange[key]) <= 2, `${key} survives hsl within two steps`);
  }

  const oklch = rgbToOklch(orange);
  const back = oklchToRgb(oklch.l, oklch.c, oklch.h);
  for (const key of ["r", "g", "b"] as const) {
    assert.ok(Math.abs(back[key] - orange[key]) <= 1, `${key} round trip within one step`);
  }
  assert.deepEqual(parseColor(`oklch(${oklch.l} ${oklch.c} ${oklch.h})`), back);
});

await check("contrast ratios match the wcag definition", () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  assert.equal(contrastRatio(white, black).toFixed(2), "21.00");
  assert.equal(contrastRatio(white, white).toFixed(2), "1.00");
});

await check("the ramp is light to dark and all valid hex", () => {
  const ramp = buildRamp(parseColor("#b7502f")!);
  assert.equal(ramp.length, 9);
  assert.ok(ramp.every((step) => /^#[0-9a-f]{6}$/.test(step)), "every step is hex");
  const lightness = ramp.map((step) => rgbToOklch(parseColor(step)!).l);
  for (let i = 1; i < lightness.length; i++) assert.ok(lightness[i] < lightness[i - 1], "ramp darkens");
});

await check("json formats, sorts and reports where it broke", () => {
  const sorted = run("json", '{"b":1,"a":{"d":2,"c":3}}', { ...DEFAULT_OPTIONS, sortKeys: true });
  assert.ok(sorted.ok && sorted.output.startsWith('{\n  "a"'), "keys sort, deeply");
  assert.ok(sorted.ok && sorted.output.includes('"c": 3'));

  const minified = run("json", '{"a": 1}', { ...DEFAULT_OPTIONS, indent: 0 });
  assert.ok(minified.ok && minified.output === '{"a":1}');

  // When the engine reports a position, say where. When it doesn't, still say
  // something short instead of quoting the whole document back.
  const located = run("json", '{"a": 1,, "b": 2}', DEFAULT_OPTIONS);
  assert.ok(!located.ok && /line 1, column 9/.test(located.error), located.ok ? "" : located.error);

  const vague = run("json", '{\n  "a": 1,\n  "b":\n}', DEFAULT_OPTIONS);
  assert.ok(!vague.ok, "an unfinished value is an error");
  if (!vague.ok) {
    assert.ok(!/is not valid json/.test(vague.error), `no engine noise: ${vague.error}`);
    assert.ok(!vague.error.includes('"a"'), "the document is not quoted back");
    assert.ok(vague.error.length < 60, `short: ${vague.error}`);
  }

  const bareWord = run("json", "undefined", DEFAULT_OPTIONS);
  assert.ok(!bareWord.ok && bareWord.error === "that isn't valid json", bareWord.ok ? "" : bareWord.error);
});

await check("url encoding round trips and a whole url gets pulled apart", () => {
  const encoded = run("url", "hello world&x=1", DEFAULT_OPTIONS);
  assert.ok(encoded.ok && encoded.output === "hello%20world%26x%3D1");
  const decoded = run("url", encoded.output, { ...DEFAULT_OPTIONS, mode: "decode" });
  assert.ok(decoded.ok && decoded.output === "hello world&x=1");

  const parsed = run("url", "https://example.com/a?q=hi&lang=en#top", DEFAULT_OPTIONS);
  assert.ok(parsed.ok && parsed.table, "a url produces a table");
  const rows = Object.fromEntries(parsed.ok ? parsed.table!.rows.map((r) => [r.label, r.value]) : []);
  assert.equal(rows.host, "example.com");
  assert.equal(rows.q, "hi");
  assert.equal(rows.hash, "top");
});

await check("jwt decodes without pretending to verify", () => {
  const header = toBase64(JSON.stringify({ alg: "HS256", typ: "JWT" }), true);
  const payload = toBase64(JSON.stringify({ sub: "1", exp: 1767225600 }), true);
  const result = run("jwt", `${header}.${payload}.signature`, DEFAULT_OPTIONS);
  assert.ok(result.ok, "decodes");
  const extra = Object.fromEntries(result.ok ? (result.extra ?? []).map((e) => [e.label, e.value]) : []);
  assert.equal(extra.alg, "HS256");
  assert.ok(extra.signature.includes("not checked"));
  assert.ok(!run("jwt", "nonsense", DEFAULT_OPTIONS).ok, "nonsense is rejected");
});

await check("times read as epoch seconds, milliseconds or iso", () => {
  const seconds = run("time", "1767225600", DEFAULT_OPTIONS);
  assert.ok(seconds.ok && seconds.output === "2026-01-01T00:00:00.000Z");
  const millis = run("time", "1767225600000", DEFAULT_OPTIONS);
  assert.ok(millis.ok && millis.output === "2026-01-01T00:00:00.000Z");
  const iso = run("time", "2026-01-01T00:00:00Z", DEFAULT_OPTIONS);
  assert.ok(iso.ok && iso.output === "2026-01-01T00:00:00.000Z");
  assert.ok(!run("time", "next tuesday-ish", DEFAULT_OPTIONS).ok);
});

await check("text conversions handle the cases people actually paste", () => {
  const result = run("text", "the quickBrown fox_jumps", DEFAULT_OPTIONS);
  assert.ok(result.ok && result.table);
  const rows = Object.fromEntries(result.ok ? result.table!.rows.map((r) => [r.label, r.value]) : []);
  assert.equal(rows.camelCase, "theQuickBrownFoxJumps");
  assert.equal(rows["snake_case"], "the_quick_brown_fox_jumps");
  assert.equal(rows["kebab-case"], "the-quick-brown-fox-jumps");
  assert.equal(run("text", "Héllo, Wörld!", DEFAULT_OPTIONS).ok, true);
  const slug = run("text", "Héllo, Wörld!", DEFAULT_OPTIONS);
  assert.equal(slug.ok ? slug.table!.rows.find((r) => r.label === "slug")!.value : "", "hello-world");
});

await check("hashing matches the published digests", async () => {
  const sha256 = await runHash("abc", "SHA-256");
  assert.ok(sha256.ok);
  assert.equal(sha256.ok ? sha256.output : "", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const sha1 = await runHash("abc", "SHA-1");
  assert.equal(sha1.ok ? sha1.output : "", "a9993e364706816aba3e25717850c26c9cd0d89d");
});

await check("empty input is never an error", () => {
  for (const tool of ["json", "base64", "url", "color", "jwt", "time", "text"] as const) {
    const result = run(tool, "   ", DEFAULT_OPTIONS);
    assert.ok(result.ok && result.output === "", `${tool} on blank input`);
  }
});

/* ------------------------------------------------------------------ field */

await check("the field is finite everywhere and moves with time", () => {
  const state = createState();
  const { cols, rows } = gridFor(800, 400, 16);
  assert.equal(cols, 50);
  assert.equal(rows, 25);

  let sum = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = sampleField(x, y, cols, rows, DEFAULT_SETTINGS, state);
      assert.ok(Number.isFinite(v), `finite at ${x},${y}`);
      sum += v;
    }
  }
  state.time = 3.5;
  let later = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) later += sampleField(x, y, cols, rows, DEFAULT_SETTINGS, state);
  assert.notEqual(sum.toFixed(4), later.toFixed(4), "the wave travels");
});

await check("the pointer raises the field around it", () => {
  const state = createState();
  const flat = sampleField(10, 10, 40, 20, DEFAULT_SETTINGS, state);
  state.pointer = { x: 10, y: 10 };
  const bulged = sampleField(10, 10, 40, 20, DEFAULT_SETTINGS, state);
  assert.ok(bulged > flat, "under the pointer the value rises");
  assert.ok(Math.abs(sampleField(38, 19, 40, 20, DEFAULT_SETTINGS, state) - sampleField(38, 19, 40, 20, DEFAULT_SETTINGS, { ...state, pointer: null })) < 0.01, "and barely moves far away");
});

await check("inverting mirrors the field", () => {
  const state = createState();
  const normal = sampleField(4, 7, 40, 20, DEFAULT_SETTINGS, state);
  const inverted = sampleField(4, 7, 40, 20, { ...DEFAULT_SETTINGS, invert: true }, state);
  assert.ok(Math.abs(normal + inverted - 1) < 1e-9);
});

/* ------------------------------------------------------------------ pulse */

await check("days bucket into the calendar they belong to", () => {
  const now = new Date(2026, 0, 15, 13, 0, 0).getTime();
  const starts = dayStarts(now, 7);
  assert.equal(starts.length, 7);
  assert.equal(new Date(starts[6]).getDate(), 15, "the last day is today");
  assert.equal(new Date(starts[0]).getDate(), 9);

  const counts = bucketByDay(
    [
      { ts: now, author: "a", message: "today" },
      { ts: starts[0] + 60_000, author: "a", message: "oldest day" },
      { ts: starts[0] - 60_000, author: "a", message: "too old" },
    ],
    starts,
  );
  assert.deepEqual(counts, [1, 0, 0, 0, 0, 0, 1]);
});

await check("quantiles, trend and histograms agree with the arithmetic", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3, 4], 0), 1);
  assert.equal(quantile([], 0.5), 0);
  assert.equal(trend([1, 1, 2, 2]), 100);
  assert.equal(trend([2, 2, 1, 1]), -50);
  assert.equal(trend([0, 0, 0, 0]), 0);

  const latencies = reviewLatencies([
    { number: 1, title: "", author: "a", created: 0, merged: 3_600_000 },
    { number: 2, title: "", author: "a", created: 0, merged: null },
    { number: 3, title: "", author: "b", created: 0, merged: 36_000_000 },
  ]);
  assert.deepEqual(latencies, [1, 10]);
  const bins = latencyHistogram(latencies);
  assert.equal(bins.find((b) => b.label === "1–4h")!.count, 1);
  assert.equal(bins.find((b) => b.label === "4–12h")!.count, 1);
  assert.equal(bins.reduce((a, b) => a + b.count, 0), latencies.length);
});

await check("contributors rank by commits and count merged pulls", () => {
  const rows = contributors(
    [
      { ts: 1, author: "mara", message: "" },
      { ts: 2, author: "mara", message: "" },
      { ts: 3, author: "iko", message: "" },
    ],
    [{ number: 1, title: "", author: "iko", created: 0, merged: 1 }],
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.commits, r.pulls]),
    [
      ["mara", 2, 0],
      ["iko", 1, 1],
    ],
  );
  assert.equal(rows[0].share, 1);
});

await check("weekday buckets start on monday", () => {
  const monday = new Date(2026, 0, 5, 12).getTime();
  const sunday = new Date(2026, 0, 11, 12).getTime();
  const days = weekdayHistogram([
    { ts: monday, author: "a", message: "" },
    { ts: sunday, author: "a", message: "" },
  ]);
  assert.deepEqual(days, [1, 0, 0, 0, 0, 0, 1]);
});

await check("resampling keeps the ends and evens out the middle", () => {
  assert.deepEqual(resample([0, 10], 5), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(resample([4], 3), [4, 4, 4]);
  assert.deepEqual(resample([], 2), [0, 0]);
  assert.equal(resample([1, 2, 3], 48).length, 48, "every range yields the same point count");
  assert.deepEqual(smooth([0, 3, 0], 3), [1.5, 1, 1.5]);
});

await check("paths are built from finite numbers and close when asked", () => {
  const box = { width: 300, height: 200, top: 10, right: 5, bottom: 20, left: 5 };
  const line = buildPath([1, 5, 2], box, 10, false);
  const area = buildPath([1, 5, 2], box, 10, true);
  assert.ok(line.startsWith("M "), "starts with a move");
  assert.ok(!/NaN|Infinity/.test(line + area), "no NaN anywhere");
  assert.ok(area.endsWith("Z"), "the area closes");
  assert.equal(buildPath([1], box, 10, false), "", "one point is not a line");
});

await check("the demo dataset stays inside its own window", () => {
  const now = new Date(2026, 5, 1, 18, 30).getTime();
  const data = buildDemo(now);
  const oldest = dayStarts(now, 90)[0];
  assert.ok(data.commits.length > 200, `enough commits, got ${data.commits.length}`);
  assert.ok(data.commits.every((c) => c.ts <= now && c.ts >= oldest), "nothing outside the window");
  assert.ok(data.pulls.every((p) => p.created <= now), "no pull request from the future");
  assert.ok(data.pulls.every((p) => p.merged === null || p.merged >= p.created), "merges follow their opening");
  assert.deepEqual(
    data.commits.map((c) => c.ts),
    [...data.commits.map((c) => c.ts)].sort((a, b) => b - a),
    "newest first",
  );
  assert.deepEqual(buildDemo(now).commits.length, data.commits.length, "and it is deterministic");
  assert.ok(data.languages.length > 0 && data.canFilterByLanguage);
});

await check("repository names parse out of anything someone might paste", () => {
  const expected = { owner: "vercel", name: "next.js" };
  for (const input of [
    "vercel/next.js",
    " vercel/next.js ",
    "https://github.com/vercel/next.js",
    "github.com/vercel/next.js",
    "https://www.github.com/vercel/next.js.git",
    "https://github.com/vercel/next.js/tree/canary",
  ]) {
    assert.deepEqual(parseRepo(input), expected, input);
  }
  assert.equal(parseRepo("nonsense"), null);
  assert.equal(parseRepo(""), null);
});

/* ------------------------------------------------------- field, on a server */

await check("every glyph in the stencil alphabet is the shape it claims to be", () => {
  checkFont();
  assert.equal(textMask("", 40, 20), null, "nothing to draw");
  assert.equal(textMask("hi", 3, 3), null, "nowhere to draw it");
});

await check("a stencil is centred, upright and made only of what it can draw", () => {
  const cols = 92;
  const rows = 44;
  const mask = textMask("dach.cam", cols, rows)!;
  assert.ok(mask, "there is a mask");

  const filled: { x: number; y: number }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (mask.data[y * cols + x]) filled.push({ x, y });
  }
  assert.ok(filled.length > 100, `enough ink, got ${filled.length}`);

  const left = Math.min(...filled.map((p) => p.x));
  const right = Math.max(...filled.map((p) => p.x));
  const top = Math.min(...filled.map((p) => p.y));
  const bottom = Math.max(...filled.map((p) => p.y));
  assert.ok(Math.abs(left - (cols - 1 - right)) <= 1, "centred across");
  assert.ok(Math.abs(top - (rows - 1 - bottom)) <= 1, "centred down");
  assert.ok(right < cols && bottom < rows, "inside the grid");

  // Characters with no glyph are dropped rather than drawn as a blank box.
  const ignored = textMask("d★d", cols, rows)!;
  const same = textMask("dd", cols, rows)!;
  assert.deepEqual([...ignored.data], [...same.data], "an unknown character leaves no gap");
});

await check("the link preview is a valid, self-contained svg", () => {
  const svg = previewSvg("dachh.cc");
  assert.ok(svg.startsWith("<svg "), "starts as svg");
  assert.ok(svg.endsWith("</svg>"), "and finishes");
  assert.ok(!svg.includes("<text"), "no text elements, so no font is needed");
  assert.ok((svg.match(/<circle/g) ?? []).length > 1000, "the field is actually drawn");
  assert.ok(!/NaN|Infinity|undefined/.test(svg), "no broken numbers");

  const empty = fieldToSvg({
    width: 200,
    height: 100,
    settings: DEFAULT_SETTINGS,
    state: createState(),
    palette: { paper: "#000000", ink: "#ffffff", accent: "#ff0000" },
  });
  assert.ok(empty.includes("<rect"), "there is always a background");
});

await check("a host becomes the name a reader would recognise", () => {
  assert.equal(labelForHost("dach.cam", "fallback"), "dach.cam");
  assert.equal(labelForHost("www.dachh.cc:3000", "fallback"), "dachh.cc");
  assert.equal(labelForHost("DACH.CAM", "fallback"), "dach.cam");
  assert.equal(labelForHost("localhost:3100", "fallback"), "fallback");
  assert.equal(labelForHost(null, "fallback"), "fallback");
  assert.equal(labelForHost("evil<script>", "fallback"), "fallback");
});

await check("the origin follows the proxy, not the socket", () => {
  const of = (entries: Record<string, string>) => requestOrigin(new Headers(entries), "https://fallback.example");
  assert.equal(of({ host: "dach.cam" }), "https://dach.cam");
  assert.equal(of({ host: "internal:3000", "x-forwarded-host": "dachh.cc", "x-forwarded-proto": "https" }), "https://dachh.cc");
  assert.equal(of({ host: "localhost:3000" }), "http://localhost:3000");
  assert.equal(of({}), "https://fallback.example");
  assert.equal(of({ host: "not a host" }), "https://fallback.example");
});

await check("an exported field runs on its own", () => {
  const options = {
    settings: { ...DEFAULT_SETTINGS, glyphs: "dots" as const, color: "duotone" as const, cell: 12 },
    stencil: "hello",
    ink: "#1b1a17",
    accent: "#b7502f",
    paper: "#f6f4ee",
  };

  const html = toHtml(options);
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
  // Parsing without running proves the generated javascript is at least valid.
  new Script(script, { filename: "field-export.js" });
  assert.ok(!/\bimport\b|\brequire\(/.test(script), "nothing to install");
  assert.ok(html.includes("<canvas"), "and something to draw on");

  const react = toReact(options);
  assert.ok(react.startsWith('"use client";'), "usable in an app router project");
  assert.ok(react.includes("export function Field"), "exports the component");
  assert.ok(/from "react"/.test(react), "react is the only import");
  assert.equal(react.match(/^import /gm)?.length, 1, "exactly one import");
});

await check("the exported react component compiles under strict typescript", () => {
  const dir = ".check-tmp";
  const file = `${dir}/Field.tsx`;
  const config = `${dir}/tsconfig.json`;
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(
      file,
      toReact({
        settings: { ...DEFAULT_SETTINGS, glyphs: "braille", color: "ink" },
        stencil: "",
        ink: "#1b1a17",
        accent: "#b7502f",
        paper: "#f6f4ee",
      }),
    );
    writeFileSync(config, JSON.stringify({ extends: "../tsconfig.json", include: ["Field.tsx"] }));
    const tsc = "node_modules/typescript/bin/tsc";
    if (!existsSync(tsc)) return;
    execFileSync(process.execPath, [tsc, "-p", config, "--noEmit"], { stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------------- palette */

await check("chroma is pulled back only when srgb cannot show it", () => {
  // A vivid red at mid lightness is inside the gamut already.
  const inside = rgbToOklch(parseColor("#b7502f")!);
  assert.equal(clampChroma(inside.l, inside.c, inside.h), inside.c, "an achievable colour is left alone");

  // Nothing is that colourful at that hue, so it has to come down.
  const pulled = clampChroma(0.5, 0.4, 150);
  assert.ok(pulled < 0.4, "reduced");
  assert.ok(inGamut(0.5, pulled, 150), "and now displayable");
  assert.ok(!inGamut(0.5, pulled + 0.01, 150), "by as little as possible");
});

await check("a scale is eleven steps, light to dark, all displayable", () => {
  const scale = buildScale(parseColor("#b7502f")!);
  assert.deepEqual(
    scale.swatches.map((s) => s.step),
    [...STEPS],
  );

  for (let i = 1; i < scale.swatches.length; i++) {
    assert.ok(scale.swatches[i].oklch.l < scale.swatches[i - 1].oklch.l, `step ${scale.swatches[i].step} is darker`);
  }
  for (const swatch of scale.swatches) {
    assert.ok(/^#[0-9a-f]{6}$/.test(swatch.hex), `${swatch.step} is hex`);
    assert.ok(inGamut(swatch.oklch.l, swatch.oklch.c, swatch.oklch.h), `${swatch.step} is inside srgb`);
    assert.ok(swatch.contrast.white >= 1 && swatch.contrast.black >= 1, "contrast is a real ratio");
    const best = Math.max(swatch.contrast.white, swatch.contrast.black);
    assert.equal(swatch.ink === "black" ? swatch.contrast.black : swatch.contrast.white, best, "picks the readable one");
  }

  assert.ok(scale.swatches[0].contrast.black > scale.swatches[0].contrast.white, "the palest step wants dark text");
  assert.ok(scale.swatches[10].contrast.white > scale.swatches[10].contrast.black, "the darkest wants light text");
});

await check("the colour you typed survives into the scale", () => {
  const input = parseColor("#3b6ea5")!;
  const kept = buildScale(input, { keepInput: true, name: "brand" });
  const anchor = kept.swatches.find((s) => s.anchor)!;
  assert.equal(anchor.hex, "#3b6ea5", "exactly, at its own step");
  assert.equal(anchor.step, kept.anchorStep);
  assert.equal(kept.swatches.filter((s) => s.anchor).length, 1, "only one step is yours");

  const smoothed = buildScale(input, { keepInput: false, name: "brand" });
  assert.equal(smoothed.swatches.filter((s) => s.anchor).length, 1);
  assert.notEqual(smoothed.swatches.find((s) => s.anchor)!.hex, "#3b6ea5", "or not, if you would rather it fit the curve");
});

await check("every output format says the same thing in its own words", () => {
  const scale = buildScale(parseColor("teal")!, { keepInput: true, name: "sea" });
  const tailwind = serialise(scale, "tailwind");
  assert.ok(tailwind.startsWith("@theme {"), "tailwind v4 uses @theme");
  assert.ok(tailwind.includes("--color-sea-500: oklch("), "named and in oklch");
  assert.equal(tailwind.match(/--color-sea-/g)?.length, 11, "all eleven");

  const css = serialise(scale, "css");
  assert.ok(css.includes(":root {") && css.includes("--sea-950: #"), "plain variables are hex");

  const parsed = JSON.parse(serialise(scale, "json")) as Record<string, Record<string, string>>;
  assert.deepEqual(Object.keys(parsed.sea).map(Number), [...STEPS]);
  assert.equal(parsed.sea[500], scale.swatches.find((s) => s.step === 500)!.hex);

  assert.equal(serialise(scale, "hex").split("\n").length, 11);
});

await check("the accent script applies a stored colour and refuses anything else", () => {
  const run = (stored: string | null) => {
    const applied = new Map<string, string>();
    const context = {
      JSON,
      localStorage: { getItem: () => stored },
      document: { documentElement: { style: { setProperty: (key: string, value: string) => applied.set(key, value) } } },
    };
    // The exact string that ships in the html, run the way a browser runs it.
    new Script(ACCENT_SCRIPT, { filename: "accent.js" }).runInNewContext(context);
    return applied;
  };

  const good = run(JSON.stringify({ light: "#b7502f", dark: "#d9765a" }));
  assert.equal(good.get("--accent-light"), "#b7502f");
  assert.equal(good.get("--accent-dark"), "#d9765a");

  for (const stored of [
    null,
    "not json",
    "null",
    JSON.stringify({ light: "#b7502f" }),
    JSON.stringify({ light: "red", dark: "#d9765a" }),
    JSON.stringify({ light: "#fff;}body{display:none", dark: "#d9765a" }),
  ]) {
    assert.equal(run(stored).size, 0, `refused: ${stored}`);
  }

  assert.equal(isAccent({ light: "#000000", dark: "#ffffff" }), true);
  assert.equal(isAccent({ light: "#000", dark: "#ffffff" }), false);
  assert.equal(isAccent(null), false);
});

console.log(results.map((r) => `  ok  ${r}`).join("\n"));
console.log(`\n${results.length} checks passed`);
