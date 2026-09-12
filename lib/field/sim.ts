/**
 * The simulation behind `field`. A grid of cells each hold a value between 0
 * and 1; that value picks a glyph out of a ramp. Everything is a pure function
 * of (position, time, pointer, ripples), so the same code drives the small
 * preview on the homepage and the full-page version.
 */

export const GLYPH_SETS = {
  ascii: " .·:;-=+*x%#@",
  braille: "⠀⠁⠃⠇⡇⡏⡟⡿⣿",
  blocks: " ░▒▓█",
  dots: " ˙·•◦●◉⬤",
  lines: " ╴╌─═━┃█",
  binary: " ...001011111",
} as const;

export type GlyphSetId = keyof typeof GLYPH_SETS;

export type ColorMode = "ink" | "accent" | "duotone";

export interface FieldSettings {
  /** Pixels per glyph. Smaller means more, smaller characters. */
  cell: number;
  /** How fast the wave travels. 0 freezes it. */
  speed: number;
  /** How much of the value range the wave uses. */
  amplitude: number;
  /** Spatial frequency: low is a slow swell, high is a fine weave. */
  scale: number;
  /** Radius, in cells, of the bulge that follows the pointer. */
  pointerRadius: number;
  glyphs: GlyphSetId;
  invert: boolean;
  color: ColorMode;
  /** Strength of the text stencil, 0 when there is no text. */
  maskStrength: number;
}

export const DEFAULT_SETTINGS: FieldSettings = {
  cell: 16,
  speed: 1,
  amplitude: 1,
  scale: 1,
  pointerRadius: 7,
  glyphs: "ascii",
  invert: false,
  color: "ink",
  maskStrength: 0.85,
};

export interface Ripple {
  /** In cell coordinates, not pixels. */
  x: number;
  y: number;
  /** The simulation time the ripple was dropped at. */
  t0: number;
}

export const RIPPLE_LIFETIME = 3.2;

export interface Mask {
  cols: number;
  rows: number;
  /** One value per cell, 0 to 1. */
  data: Float32Array;
}

export interface FieldState {
  time: number;
  /** Pointer position in cell coordinates, or null when it has left. */
  pointer: { x: number; y: number } | null;
  ripples: Ripple[];
  mask: Mask | null;
}

export interface Palette {
  ink: string;
  accent: string;
  font: string;
}

export function createState(): FieldState {
  return { time: 0, pointer: null, ripples: [], mask: null };
}

/** Bilinear sample of the stencil, so text stays smooth as the grid changes size. */
function sampleMask(mask: Mask, x: number, y: number, cols: number, rows: number): number {
  if (cols < 2 || rows < 2) return 0;
  const mx = (x / (cols - 1)) * (mask.cols - 1);
  const my = (y / (rows - 1)) * (mask.rows - 1);
  const x0 = Math.floor(mx);
  const y0 = Math.floor(my);
  const x1 = Math.min(mask.cols - 1, x0 + 1);
  const y1 = Math.min(mask.rows - 1, y0 + 1);
  const fx = mx - x0;
  const fy = my - y0;
  const at = (cx: number, cy: number) => mask.data[cy * mask.cols + cx] ?? 0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * The value of one cell. Three layers add up: a standing wave, the pointer,
 * and any ripples still alive.
 */
export function sampleField(
  x: number,
  y: number,
  cols: number,
  rows: number,
  settings: FieldSettings,
  state: FieldState,
): number {
  const t = state.time;
  const k = settings.scale;
  let v =
    0.32 +
    settings.amplitude *
      (0.34 * Math.sin(x * 0.22 * k + t * 0.7) * Math.cos(y * 0.31 * k - t * 0.55) +
        0.2 * Math.sin((x - y) * 0.13 * k + t * 0.4));

  if (state.mask && settings.maskStrength > 0) {
    v += settings.maskStrength * sampleMask(state.mask, x, y, cols, rows);
  }

  const p = state.pointer;
  if (p) {
    const dx = x - p.x;
    const dy = y - p.y;
    v += 0.75 * Math.exp(-(dx * dx + dy * dy) / (settings.pointerRadius * 1.6));
  }

  for (const r of state.ripples) {
    const age = t - r.t0;
    const dist = Math.hypot(x - r.x, y - r.y);
    const front = dist - age * 9;
    v += 0.6 * Math.sin(front * 0.9) * Math.exp(-(front * front) / 9) * Math.exp(-age * 0.9);
  }

  return settings.invert ? 1 - v : v;
}

/** Mix two hex colours. Values outside 0..1 are clamped by the caller. */
function mix(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  };
  if (!a.startsWith("#") || !b.startsWith("#")) return t > 0.5 ? b : a;
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(ar, br)} ${c(ag, bg)} ${c(ab, bb)})`;
}

export function readPalette(element: Element): Palette {
  const styles = getComputedStyle(element);
  return {
    ink: styles.getPropertyValue("--ink").trim() || "#000000",
    accent: styles.getPropertyValue("--accent").trim() || "#b7502f",
    font: styles.getPropertyValue("--font-geist-mono").trim() || "monospace",
  };
}

export interface Grid {
  cols: number;
  rows: number;
  offsetX: number;
  offsetY: number;
}

export function gridFor(width: number, height: number, cell: number): Grid {
  const cols = Math.max(1, Math.floor(width / cell));
  const rows = Math.max(1, Math.floor(height / cell));
  return { cols, rows, offsetX: (width - cols * cell) / 2, offsetY: (height - rows * cell) / 2 };
}

/**
 * Draws one frame. Sizing the backing store is done here so callers only ever
 * have to hand over a canvas with a size in CSS pixels.
 */
export function drawField(canvas: HTMLCanvasElement, settings: FieldSettings, state: FieldState, palette: Palette) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);
  if (w === 0 || h === 0) return;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const { cell } = settings;
  const { cols, rows, offsetX, offsetY } = gridFor(w, h, cell);
  const ramp = GLYPH_SETS[settings.glyphs];

  ctx.font = `${cell * 0.86}px ${palette.font}, monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  state.ripples = state.ripples.filter((r) => state.time - r.t0 < RIPPLE_LIFETIME);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const raw = sampleField(x, y, cols, rows, settings, state);
      const v = Math.max(0, Math.min(0.9999, raw));
      const glyph = ramp[Math.floor(v * ramp.length)];
      if (glyph === " " || glyph === "⠀") continue;

      ctx.fillStyle =
        settings.color === "accent"
          ? palette.accent
          : settings.color === "duotone"
            ? mix(palette.ink, palette.accent, v)
            : v > 0.86
              ? palette.accent
              : palette.ink;
      ctx.globalAlpha = 0.18 + v * 0.82;
      ctx.fillText(glyph, offsetX + x * cell + cell / 2, offsetY + y * cell + cell / 2);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Rasterises text into a stencil the field can read. The text is drawn once at
 * grid resolution and the alpha channel becomes the density.
 */
export function buildMask(text: string, cols: number, rows: number, font: string): Mask | null {
  const trimmed = text.trim();
  if (!trimmed || cols < 2 || rows < 2) return null;

  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const lines = trimmed.split("\n");
  // Find the largest size that still fits, rather than guessing at one.
  let size = rows / lines.length;
  for (let attempt = 0; attempt < 24 && size > 1; attempt++) {
    ctx.font = `700 ${size}px ${font}, sans-serif`;
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
