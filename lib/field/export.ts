/**
 * Turns the current settings into something you can take away: a self-contained
 * React component, a single html file, or a static svg of this exact frame.
 *
 * The generated code deliberately repeats the simulation rather than importing
 * it. An export that needs the rest of this repository to run is not an export.
 */

import { GLYPH_SETS, type FieldSettings } from "./sim.ts";

export interface ExportOptions {
  settings: FieldSettings;
  stencil: string;
  /** Colours are baked in, since the target project won't have these variables. */
  ink: string;
  accent: string;
  paper: string;
}

export type ExportKind = "react" | "html" | "svg";

export const EXPORTS: { id: ExportKind; label: string; filename: string }[] = [
  { id: "react", label: "react", filename: "Field.tsx" },
  { id: "html", label: "html", filename: "field.html" },
  { id: "svg", label: "svg", filename: "field.svg" },
];

const json = (value: unknown) => JSON.stringify(value);

/**
 * The simulation, shared by both runnable exports. `typed` decides whether the
 * annotations are written out, because the react file lands in a project that
 * probably has `strict` turned on and the html file must be plain javascript.
 */
function engine(options: ExportOptions, typed: boolean): string {
  const { settings, stencil, ink, accent } = options;
  /** An annotation, or nothing at all. */
  const t = (annotation: string) => (typed ? annotation : "");

  const types = typed
    ? `type Mask = { cols: number; rows: number; data: Float32Array };
type Ripple = { x: number; y: number; t0: number };
type Point = { x: number; y: number };
type ColorMode = "ink" | "accent" | "duotone";

`
    : "";

  return `${types}const RAMP = ${json(GLYPH_SETS[settings.glyphs])};
const STENCIL = ${json(stencil)};
const CELL = ${settings.cell};
const SPEED = ${settings.speed};
const AMPLITUDE = ${settings.amplitude};
const WEAVE = ${settings.scale};
const POINTER = ${settings.pointerRadius};
const INVERT = ${settings.invert};
const MASK_WEIGHT = ${settings.maskStrength};
const COLOR_MODE${t(": ColorMode")} = ${json(settings.color)};
const INK = ${json(ink)};
const ACCENT = ${json(accent)};
const RIPPLE_LIFETIME = 3.2;

// The word is drawn once at grid resolution; its alpha becomes extra density.
function buildMask(text${t(": string")}, cols${t(": number")}, rows${t(": number")})${t(": Mask | null")} {
  if (!text.trim() || cols < 2 || rows < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const lines = text.split("\\n");
  let size = rows / lines.length;
  for (let i = 0; i < 24 && size > 1; i++) {
    ctx.font = "700 " + size + "px sans-serif";
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    if (widest <= cols * 0.92 && size * lines.length <= rows * 0.92) break;
    size *= 0.9;
  }

  ctx.clearRect(0, 0, cols, rows);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = size * 1.05;
  const top = rows / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, cols / 2, top + i * lineHeight));

  const { data } = ctx.getImageData(0, 0, cols, rows);
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] / 255;
  return { cols, rows, data: out };
}

function sampleMask(mask${t(": Mask")}, x${t(": number")}, y${t(": number")}, cols${t(": number")}, rows${t(": number")})${t(": number")} {
  if (cols < 2 || rows < 2) return 0;
  const mx = (x / (cols - 1)) * (mask.cols - 1);
  const my = (y / (rows - 1)) * (mask.rows - 1);
  const x0 = Math.floor(mx);
  const y0 = Math.floor(my);
  const x1 = Math.min(mask.cols - 1, x0 + 1);
  const y1 = Math.min(mask.rows - 1, y0 + 1);
  const fx = mx - x0;
  const fy = my - y0;
  const at = (cx${t(": number")}, cy${t(": number")}) => mask.data[cy * mask.cols + cx] || 0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

// Three things add up: a standing wave, the pointer, and any live ripples.
function sample(
  x${t(": number")},
  y${t(": number")},
  cols${t(": number")},
  rows${t(": number")},
  time${t(": number")},
  pointer${t(": Point | null")},
  ripples${t(": Ripple[]")},
  mask${t(": Mask | null")},
)${t(": number")} {
  let v =
    0.32 +
    AMPLITUDE *
      (0.34 * Math.sin(x * 0.22 * WEAVE + time * 0.7) * Math.cos(y * 0.31 * WEAVE - time * 0.55) +
        0.2 * Math.sin((x - y) * 0.13 * WEAVE + time * 0.4));

  if (mask) v += MASK_WEIGHT * sampleMask(mask, x, y, cols, rows);

  if (pointer) {
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    v += 0.75 * Math.exp(-(dx * dx + dy * dy) / (POINTER * 1.6));
  }

  for (const ripple of ripples) {
    const age = time - ripple.t0;
    const front = Math.hypot(x - ripple.x, y - ripple.y) - age * 9;
    v += 0.6 * Math.sin(front * 0.9) * Math.exp(-(front * front) / 9) * Math.exp(-age * 0.9);
  }

  return INVERT ? 1 - v : v;
}

function mixColor(a${t(": string")}, b${t(": string")}, amount${t(": number")})${t(": string")} {
  const parse = (hex${t(": string")}) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const channel = (x${t(": number")}, y${t(": number")}) => Math.round(x + (y - x) * amount);
  return "rgb(" + channel(ar, br) + " " + channel(ag, bg) + " " + channel(ab, bb) + ")";
}`;
}

/** The animation loop and the pointer wiring, shared by both runnable exports. */
function loop(typed: boolean, tail: string): string {
  const t = (annotation: string) => (typed ? annotation : "");

  return `  let mask${t(": Mask | null")} = null;
  let maskKey = "";
  let time = 0;
  let pointer${t(": Point | null")} = null;
  let ripples${t(": Ripple[]")} = [];
  let last = performance.now();

  const toCell = (event${t(": PointerEvent")}) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / CELL, y: (event.clientY - rect.top) / CELL };
  };
  const onMove = (event${t(": PointerEvent")}) => {
    pointer = toCell(event);
  };
  const onLeave = () => {
    pointer = null;
  };
  const onDown = (event${t(": PointerEvent")}) => {
    const cell = toCell(event);
    ripples.push({ x: cell.x, y: cell.y, t0: time });
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("pointerdown", onDown);

  const draw = (dt${t(": number")}) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (!w || !h) return;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cols = Math.max(1, Math.floor(w / CELL));
    const rows = Math.max(1, Math.floor(h / CELL));
    const key = cols + "x" + rows;
    if (key !== maskKey) {
      mask = buildMask(STENCIL, cols, rows);
      maskKey = key;
    }

    const offsetX = (w - cols * CELL) / 2;
    const offsetY = (h - rows * CELL) / 2;
    ctx.font = CELL * 0.86 + "px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    time += dt * SPEED;
    ripples = ripples.filter((ripple) => time - ripple.t0 < RIPPLE_LIFETIME);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = Math.max(0, Math.min(0.9999, sample(x, y, cols, rows, time, pointer, ripples, mask)));
        const glyph = RAMP[Math.floor(v * RAMP.length)];
        if (glyph === " " || glyph === "\\u2800") continue;
        ctx.fillStyle =
          COLOR_MODE === "accent" ? ACCENT : COLOR_MODE === "duotone" ? mixColor(INK, ACCENT, v) : v > 0.86 ? ACCENT : INK;
        ctx.globalAlpha = 0.18 + v * 0.82;
        ctx.fillText(glyph, offsetX + x * CELL + CELL / 2, offsetY + y * CELL + CELL / 2);
      }
    }
    ctx.globalAlpha = 1;
  };

  let frame = requestAnimationFrame(function step(now${t(": number")}) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    draw(reduced ? 0 : dt);
    frame = requestAnimationFrame(step);
  });
${tail}`;
}

export function toReact(options: ExportOptions): string {
  return `"use client";

// A field of glyphs whose brightness moves in waves. Move the pointer to push
// it, click to drop a ripple. Nothing here but react.
import { useEffect, useRef } from "react";

${engine(options, true)}

export function Field({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

${loop(
  true,
  `
    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
    };`,
)}
  }, []);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="A field of characters that ripples as you move over it"
      className={className}
      style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair", touchAction: "none" }}
    />
  );
}
`;
}

export function toHtml(options: ExportOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>field</title>
<style>
  html, body { height: 100%; margin: 0; background: ${options.paper}; }
  canvas { display: block; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
</style>
</head>
<body>
<canvas id="field" role="img" aria-label="A field of characters that ripples as you move over it"></canvas>
<script>
${engine(options, false)}

(function () {
  const canvas = document.getElementById("field");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

${loop(false, "")}
})();
</script>
</body>
</html>
`;
}
