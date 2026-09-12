/**
 * The picture that goes out with a link to this site: the field from `field`,
 * spelling whichever domain the page was asked for.
 */

import { createState, DEFAULT_SETTINGS, type FieldSettings } from "./sim.ts";
import { fieldToSvg } from "./svg.ts";
import { textMask } from "./text.ts";

export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

/** The settings the field was left on when this was chosen. */
export const PREVIEW_SETTINGS: FieldSettings = {
  ...DEFAULT_SETTINGS,
  cell: 12,
  speed: 3,
  // Quieter than the app's default: the wave is the texture here, not the subject.
  amplitude: 0.5,
  scale: 0.6,
  pointerRadius: 6,
  glyphs: "dots",
  color: "accent",
  maskStrength: 0.95,
};

/** A fixed moment in the wave, so the same link always makes the same picture. */
const FROZEN_AT = 4.2;

export interface PreviewTheme {
  paper: string;
  ink: string;
  accent: string;
}

export const PREVIEW_THEME: PreviewTheme = { paper: "#121210", ink: "#e8e5dd", accent: "#d9765a" };

export function previewSvg(label: string, theme: PreviewTheme = PREVIEW_THEME): string {
  const cols = Math.floor(PREVIEW_WIDTH / PREVIEW_SETTINGS.cell);
  const rows = Math.floor(PREVIEW_HEIGHT / PREVIEW_SETTINGS.cell);
  const state = createState();
  state.time = FROZEN_AT;
  state.mask = textMask(label, cols, rows);

  return fieldToSvg({
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    settings: PREVIEW_SETTINGS,
    state,
    palette: theme,
  });
}

/**
 * The hostname as a reader would write it: no port, no `www.`, and nothing that
 * the stencil alphabet can't draw.
 */
export function labelForHost(host: string | null, fallback: string): string {
  const cleaned = (host ?? "")
    .split(":")[0]
    .replace(/^www\./i, "")
    .toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned) ? cleaned : fallback;
}
