/** Run with: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-rendering.mts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { COLS, ROWS } from "../lib/snake/game.ts";

const root = new URL("../", import.meta.url);
const require = createRequire(new URL("package.json", root));
// Exercise browser modules with a deterministic clock and canvas, without starting a server.
function load<T>(file: string, globals: Record<string, unknown>, imports: Record<string, unknown> = {}): T {
  const exports = {};
  const source = readFileSync(new URL(file, root), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  runInNewContext(outputText, {
    exports,
    require: (id: string) => imports[id] ?? require(id.startsWith("@/") ? `./${id.slice(2)}.ts` : id),
    ...globals,
  });
  return exports as T;
}

type Rect = [number, number, number, number];
let paths = 0;
class Path {
  rects: Rect[] = [];
  constructor() { paths++; }
  rect(...rect: Rect) { this.rects.push(rect); }
}
const { drawBoard } = load<typeof import("../components/snake/draw.ts")>("components/snake/draw.ts", { Path2D: Path });
let fills = 0;
const pixels = new Map<string, string>();
const ctx = {
  fillStyle: "",
  save() {}, restore() {}, scale() {},
  fillRect(x: number, y: number, w: number, h: number) {
    fills++;
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) pixels.set(`${c},${r}`, this.fillStyle);
  },
  fill(path: Path) {
    const before = fills;
    for (const rect of path.rects) this.fillRect(...rect);
    fills = before + 1;
  },
};
for (let frame = 0; frame < 2; frame++) {
  fills = 0;
  drawBoard(ctx as unknown as CanvasRenderingContext2D, { body: [], dir: 1, apple: -1, gold: -1, dead: false }, 20, frame);
  assert.ok(fills <= 2, `Snake background: ${fills} draw calls, expected at most 2`);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    assert.equal(pixels.get(`${c},${r}`), (r + c) % 2 ? "#a2d149" : "#aad751");
  }
}
assert.equal(paths, 1, "Reuse the checkerboard across frames and boards");
console.log("Snake: 2 background draws, same checkerboard, path reused");

for (const hz of [30, 60, 120, 144]) {
  let now = 100_000;
  let frame = () => {};
  let second = () => {};
  const noop = () => {};
  const storage = new Map<string, string>();
  const document = { title: "cookie", visibilityState: "visible", addEventListener: noop, removeEventListener: noop };
  const { CookieGame } = load<typeof import("../components/cookie/runtime.ts")>("components/cookie/runtime.ts", {
    Date: { now: () => now }, performance: { now: () => now }, document,
    requestAnimationFrame: (cb: () => void) => (frame = cb, 1), cancelAnimationFrame: noop,
    window: {
      localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
      addEventListener: noop, removeEventListener: noop, clearTimeout: noop,
      setInterval: (cb: () => void) => (second = cb, 1), clearInterval: noop,
    },
  });
  const game = new CookieGame();
  game.start();
  game.state.run.owned[0] = 10;
  const cps = game.production().total;
  let updates = 0;
  game.subscribe(() => updates++);
  for (let i = 1; i <= hz; i++) { now = 100_000 + i * 1000 / hz; frame(); }
  assert.ok(updates <= 20, `Cookie at ${hz}Hz: ${updates} UI updates, expected at most 20`);
  const passiveUpdates = updates;
  const beforeClick = game.state.run.cookies;
  assert.ok(game.click() > 0);
  assert.ok(game.state.run.cookies > beforeClick);
  assert.equal(updates, passiveUpdates + 1, "Clicks still notify immediately between ticks");
  const clicked = game.state.run.cookies - beforeClick;
  document.visibilityState = "hidden";
  now += 1000;
  second();
  assert.ok(Math.abs(game.state.run.cookies - clicked - cps * 2) < 1e-9, "All elapsed time produces cookies, including background time");
  game.stop();
  console.log(`Cookie at ${hz}Hz: ${passiveUpdates} UI updates/sec; immediate clicks and elapsed production preserved`);
}

// A late movement packet must not send another crewmate through a wall.
const { Engine } = load<typeof import("../components/sus/engine.ts")>("components/sus/engine.ts", {}, {
  "@/components/game/clock": { serverNow: () => 0 },
});
const engine = new Engine({} as import("../components/sus/room-client.ts").SusClient);
// Inspect the interpolation seam with fixed packet times (no network timing noise).
type Sample = { t: number; x: number; y: number; f: number; m: number; v: number };
const interpolate = (engine as unknown as { sampleAt(s: Sample[], t: number): Sample }).sampleAt.bind(engine);
const packets = [
  { t: 0, x: 1900, y: 175, f: 1, m: 1, v: 0 },
  { t: 220, x: 1940, y: 175, f: 1, m: 1, v: 0 },
];
assert.equal(interpolate(packets, 110).x, 1920);
const late = interpolate(packets, 2000);
assert.ok(Math.abs(late.x - (1940 + 40 * 140 / 220)) < 1e-9, `Late packet extrapolated to ${late.x}; prediction must stop after 140ms`);
assert.equal(interpolate([packets[0], { ...packets[1], m: 0 }], 2000).x, 1940, "Stopped players stay stopped");
assert.equal(interpolate([packets[0], { ...packets[1], x: 3000 }], 2000).x, 3000, "Teleports are never extrapolated");
console.log("Sus: delayed packets have bounded prediction; stops and teleports stay put");

// Standing still should reuse the fog, but movement, vision and resizing invalidate it.
let fogPaints = 0;
const surface = { width: 1280, height: 800 };
const fogContext = { createRadialGradient: () => { fogPaints++; return { addColorStop() {} }; } };
const fog = { width: 0, height: 0, getContext: () => fogContext };
const sceneContext = new Proxy({ canvas: surface }, { get: (target, key) => key === "canvas" ? target.canvas : () => {} });
// Keep assigned canvas methods visible while stubbing the other drawing commands.
const fctx = new Proxy(fogContext, { get: (target, key) => Object.hasOwn(target, key) ? Reflect.get(target, key) : () => {} });
fog.getContext = () => fctx;
const { drawScene } = load<typeof import("../components/sus/draw.ts")>("components/sus/draw.ts", {
  Path2D: Path, document: { createElement: () => ({ getContext: () => sceneContext }) },
});
const scene = {
  view: { players: [], game: {} }, mine: { tasks: [], bodies: [], mates: [], scanning: [], alive: true, dark: false },
  pos: { x: 1940, y: 175 }, range: 380, visible: [], puffs: [],
} as unknown as import("../components/sus/engine.ts").Engine;
const paint = (w = 1280, dpr = 1) => drawScene(sceneContext as unknown as CanvasRenderingContext2D, fog as unknown as HTMLCanvasElement, scene, w, 800, dpr, 0);
paint(); paint();
assert.equal(fogPaints, 1, "Stationary frames reuse the fog mask");
scene.pos.x++;
paint();
assert.equal(fogPaints, 2);
scene.mine!.dark = true;
paint();
assert.equal(fogPaints, 3, "Lights changes redraw fog");
paint(1000); paint(1000, 2);
assert.equal(fogPaints, 5, "Viewport and pixel density changes redraw fog");
console.log("Sus: fog reused when stationary, refreshed on movement, lights and resize");

// The cadence includes request time, rather than adding network latency to every poll.
for (const [file, name, args] of [
  ["geo/room-client", "RoomClient", ["BCDF"]],
  ["draw/room-client", "DrawClient", ["BCDF"]],
  ["phone/room-client", "PhoneClient", ["BCDF"]],
  ["shape/room-client", "ShapeClient", ["BCDF"]],
  ["hang/room-client", "HangClient", ["BCDF"]],
  ["sus/room-client", "SusClient", ["BCDF"]],
  ["arcade/versus-client", "VersusClient", ["flap", "BCDF"]],
] as const) {
  for (const [latency, hidden, failed, expected] of [[600, false, false, 1400], [2500, false, false, 100], [600, true, false, 15000], [600, false, true, 4000]] as const) {
    let now = 100_000;
    let delay = 0;
    const noop = () => {};
    const exports = load<Record<string, new (...args: string[]) => { start(): void; stop(): void }>>(`components/${file}.ts`, {
      Date: { now: () => now }, TextEncoder,
      document: { visibilityState: hidden ? "hidden" : "visible", addEventListener: noop, removeEventListener: noop },
      setInterval: () => 1, clearInterval: noop, clearTimeout: noop,
      setTimeout: (_cb: () => void, ms: number) => (delay = ms, 1),
      fetch: async () => {
        now += latency;
        if (failed) throw new Error("offline");
        return { ok: true, status: 200, json: async () => ({ version: 1, now, players: [], game: null, seals: {}, phase: "lobby" }) };
      },
    }, { "@/components/game/clock": { noteServerTime: noop, serverNow: () => now } });
    const client = new exports[name](...args);
    client.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    client.stop();
    assert.equal(delay, expected, `${name}: latency=${latency}, hidden=${hidden}, failed=${failed}`);
  }
  console.log(`${name}: network time included in cadence; slow requests bounded; hidden polling and failure backoff preserved`);
}

// Race positions use the same cadence even when a live exchange takes 120ms.
for (const [game, component] of [["snake", "SnakeRace"], ["flap", "FlapRace"]] as const) {
  let now = 0;
  let delay = 0;
  const effects: (() => void | (() => void))[] = [];
  const noop = () => {};
  const exports = load<Record<string, (props: unknown) => unknown>>(`components/${game}/Race.tsx`, {
    performance: { now: () => now },
    setTimeout: (_cb: () => void, ms: number) => (delay = ms, 1), clearTimeout: noop,
  }, {
    react: { useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, noop], useEffect: (effect: () => void) => effects.push(effect) },
    "./Game": {}, "./draw": { SNAKE_COLORS: ["blue"], BIRD_COLORS: ["yellow"] },
  });
  exports[component]({
    round: { players: [], seed: "test" }, me: "me", names: new Map(), playing: true,
    client: { live: async () => { now += 120; return {}; } },
  });
  const cleanup = effects[game === "snake" ? 0 : 1]();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(delay, game === "snake" ? 80 : 50, `${game}: live exchange includes request time and keeps a minimum pause`);
  if (cleanup) cleanup();
}
console.log("Snake/flap: live exchange cadence includes network time");

// Walking and stopping both publish immediately; network time counts toward position cadence.
{
  let now = 0;
  let wait = -1;
  const noop = () => {};
  const { Engine: LiveEngine } = load<typeof import("../components/sus/engine.ts")>("components/sus/engine.ts", {
    performance: { now: () => now },
    window: { addEventListener: noop, removeEventListener: noop },
    setTimeout: (_cb: () => void, ms: number) => (wait = ms, 1), clearTimeout: noop,
  }, { "@/components/game/clock": { serverNow: () => now } });
  const client = {
    position: async () => { now += 100; return { now, pos: {}, version: 1 }; },
    zone: async () => null,
  };
  const live = new LiveEngine(client as unknown as import("../components/sus/room-client.ts").SusClient);
  live.view = { players: [], game: { phase: "action", index: 1 } } as unknown as NonNullable<typeof live.view>;
  live.mine = { game: 1, alive: true, tasks: [], bodies: [], mates: [], dead: [], zone: "cafeteria" } as unknown as NonNullable<typeof live.mine>;
  live.pos = { x: 1940, y: 175 };
  live.attach();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(wait, 120, "Position request plus wait takes 220ms");
  live.setStick(1, 0);
  live.update(1 / 60);
  assert.equal(wait, 0, "Starting movement publishes immediately");
  wait = -1;
  live.setStick(0, 0);
  live.update(1 / 60);
  assert.equal(wait, 0, "Stopping movement publishes immediately");
  live.detach();
}
console.log("Sus: starting and stopping publish immediately; position cadence includes network time");
