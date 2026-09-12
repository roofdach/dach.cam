/**
 * Colour maths, shared by `snip` and `palette`. sRGB in and out, with OKLab in
 * the middle because it is the only one of these spaces where "a bit lighter"
 * means the same thing at every hue.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();

  const hex = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/);
  if (rgb) return { r: clamp255(+rgb[1]), g: clamp255(+rgb[2]), b: clamp255(+rgb[3]) };

  const hsl = s.match(/^hsla?\(\s*([\d.-]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%/);
  if (hsl) return hslToRgb(+hsl[1], +hsl[2], +hsl[3]);

  const oklch = s.match(/^oklch\(\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.-]+)(?:deg)?/);
  if (oklch) {
    const l = oklch[2] === "%" ? +oklch[1] / 100 : +oklch[1];
    return oklchToRgb(l, +oklch[3], +oklch[4]);
  }

  const named = NAMED[s];
  if (named) return parseColor(named);

  return null;
}

/** A small set, only the names people actually type into a converter. */
const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  grey: "#808080",
  gray: "#808080",
  pink: "#ffc0cb",
  teal: "#008080",
};

export function hslToRgb(hDeg: number, sPct: number, lPct: number): Rgb {
  const h = ((hDeg % 360) + 360) % 360;
  const s = Math.min(100, Math.max(0, sPct)) / 100;
  const l = Math.min(100, Math.max(0, lPct)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255) };
}

export function rgbToHsl({ r, g, b }: Rgb) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = h * 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (c: number) => {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return clamp255(s * 255);
};

/** sRGB to OKLCH, using Björn Ottosson's matrices. */
export function rgbToOklch({ r, g, b }: Rgb) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 0.0001 ? 0 : h };
}

/** OKLCH to linear sRGB, unclamped: values outside 0..1 are outside the gamut. */
export function oklchToLinear(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);

  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklchToRgb(L: number, C: number, hDeg: number): Rgb {
  const [r, g, b] = oklchToLinear(L, C, hDeg);
  return { r: fromLinear(r), g: fromLinear(g), b: fromLinear(b) };
}

/** Whether a colour can be shown on an ordinary screen without being clipped. */
export function inGamut(L: number, C: number, hDeg: number, epsilon = 1e-5): boolean {
  return oklchToLinear(L, C, hDeg).every((v) => v >= -epsilon && v <= 1 + epsilon);
}

/**
 * The most colourful version of this hue and lightness that sRGB can actually
 * show. Clipping the channels instead would bend the hue, which is the thing
 * people notice.
 */
export function clampChroma(L: number, C: number, hDeg: number): number {
  if (inGamut(L, C, hDeg)) return C;
  let low = 0;
  let high = C;
  // 20 halvings takes the error below a millionth, far under a visible step.
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (inGamut(L, mid, hDeg)) low = mid;
    else high = mid;
  }
  return low;
}

export const toHex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

export function relativeLuminance({ r, g, b }: Rgb) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: Rgb, b: Rgb) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Same hue and chroma, stepped through lightness, so the ramp reads evenly. */
export function buildRamp(rgb: Rgb, steps = 9): string[] {
  const { c, h } = rgbToOklch(rgb);
  return Array.from({ length: steps }, (_, i) => {
    const l = 0.95 - (i / (steps - 1)) * 0.82;
    // Chroma has to fall off at the ends or the lightest and darkest steps clip.
    const falloff = 1 - Math.abs(l - 0.55) / 0.62;
    return toHex(oklchToRgb(l, c * Math.max(0.25, falloff), h));
  });
}
