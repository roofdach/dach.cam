/**
 * The scale behind `palette`. One colour goes in; eleven come out, spaced the
 * way tailwind v4 spaces its own palettes, every step pulled back inside sRGB
 * and measured for contrast.
 */

import { clampChroma, contrastRatio, inGamut, oklchToRgb, rgbToOklch, toHex, type Rgb } from "../color.ts";

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Step = (typeof STEPS)[number];

/**
 * Lightness per step, read off tailwind v4's own palettes. They are not evenly
 * spaced: the light end is crowded so pale tints stay distinguishable, and 950
 * drops away for a near-black.
 */
const LIGHTNESS = [0.971, 0.936, 0.885, 0.808, 0.704, 0.637, 0.577, 0.505, 0.444, 0.396, 0.258];

/**
 * Chroma as a fraction of the scale's most saturated step. Colour peaks at 500
 * and falls off towards both ends, which is what stops the tints looking dirty
 * and the shades looking neon.
 */
const CHROMA = [0.055, 0.127, 0.262, 0.439, 0.713, 1, 0.878, 0.747, 0.62, 0.532, 0.388];

export interface Swatch {
  step: Step;
  hex: string;
  rgb: Rgb;
  oklch: { l: number; c: number; h: number };
  /** True when sRGB could not show the requested chroma and it was pulled in. */
  clipped: boolean;
  contrast: { white: number; black: number };
  /** Whichever of black or white is readable on this step. */
  ink: "black" | "white";
  grade: "AAA" | "AA" | "AA large" | "fails";
  /** True for the step the input colour landed on. */
  anchor: boolean;
}

export interface Scale {
  name: string;
  swatches: Swatch[];
  /** The step the input colour was closest to. */
  anchorStep: Step;
  input: { hex: string; oklch: { l: number; c: number; h: number } };
}

export interface ScaleOptions {
  /** Keep the input colour exactly, at whichever step it is closest to. */
  keepInput: boolean;
  /** Name used for the css variables, e.g. `brand` gives `--color-brand-500`. */
  name: string;
}

export const DEFAULT_SCALE_OPTIONS: ScaleOptions = { keepInput: true, name: "brand" };

const grade = (ratio: number): Swatch["grade"] =>
  ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "fails";

function describe(step: Step, l: number, c: number, h: number, anchor: boolean, requested: number): Swatch {
  const rgb = oklchToRgb(l, c, h);
  const white = contrastRatio(rgb, { r: 255, g: 255, b: 255 });
  const black = contrastRatio(rgb, { r: 0, g: 0, b: 0 });
  const ink = black >= white ? "black" : "white";
  return {
    step,
    hex: toHex(rgb),
    rgb,
    oklch: { l, c, h },
    clipped: requested - c > 0.0005,
    contrast: { white, black },
    ink,
    grade: grade(Math.max(white, black)),
    anchor,
  };
}

/** Eleven steps built around one colour. */
export function buildScale(input: Rgb, options: ScaleOptions = DEFAULT_SCALE_OPTIONS): Scale {
  const { l: inputL, c: inputC, h } = rgbToOklch(input);

  // The input belongs to whichever step it is already closest to in lightness.
  let anchorIndex = 0;
  for (let i = 1; i < LIGHTNESS.length; i++) {
    if (Math.abs(LIGHTNESS[i] - inputL) < Math.abs(LIGHTNESS[anchorIndex] - inputL)) anchorIndex = i;
  }

  // Scale the whole curve so the anchor step carries the input's own chroma.
  const peak = CHROMA[anchorIndex] > 0 ? inputC / CHROMA[anchorIndex] : inputC;

  const swatches = STEPS.map((step, i) => {
    const anchor = i === anchorIndex;
    if (anchor && options.keepInput) {
      return describe(step, inputL, inputC, h, true, inputC);
    }
    const requested = CHROMA[i] * peak;
    return describe(step, LIGHTNESS[i], clampChroma(LIGHTNESS[i], requested, h), h, anchor, requested);
  });

  return {
    name: options.name,
    swatches,
    anchorStep: STEPS[anchorIndex],
    input: { hex: toHex(input), oklch: { l: inputL, c: inputC, h } },
  };
}

/** True when the colour someone typed is itself outside sRGB. */
export function inputIsDisplayable(input: Rgb): boolean {
  const { l, c, h } = rgbToOklch(input);
  return inGamut(l, c, h);
}

/* ------------------------------------------------------------------ output */

export type Format = "tailwind" | "css" | "hex" | "json";

export const FORMATS: { id: Format; label: string; language: string }[] = [
  { id: "tailwind", label: "tailwind v4", language: "css" },
  { id: "css", label: "css variables", language: "css" },
  { id: "hex", label: "hex", language: "text" },
  { id: "json", label: "json", language: "json" },
];

const oklchString = ({ l, c, h }: { l: number; c: number; h: number }) =>
  `oklch(${(l * 100).toFixed(2)}% ${c.toFixed(4)} ${h.toFixed(2)})`;

export function serialise(scale: Scale, format: Format): string {
  switch (format) {
    case "tailwind":
      return [
        "@theme {",
        ...scale.swatches.map((s) => `  --color-${scale.name}-${s.step}: ${oklchString(s.oklch)};`),
        "}",
      ].join("\n");

    case "css":
      return [
        ":root {",
        ...scale.swatches.map((s) => `  --${scale.name}-${s.step}: ${s.hex};`),
        "}",
      ].join("\n");

    case "hex":
      return scale.swatches.map((s) => `${scale.name}-${String(s.step).padStart(3, " ")}  ${s.hex}`).join("\n");

    case "json":
      return JSON.stringify(
        { [scale.name]: Object.fromEntries(scale.swatches.map((s) => [s.step, s.hex])) },
        null,
        2,
      );
  }
}
