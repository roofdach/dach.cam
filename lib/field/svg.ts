/**
 * Renders one frame of the field as an SVG string. Circles rather than glyphs,
 * so it needs no font and can be produced on a server — which is how the link
 * preview gets made.
 */

import { GLYPH_SETS, sampleField, type FieldSettings, type FieldState } from "./sim.ts";

export interface SvgOptions {
  width: number;
  height: number;
  settings: FieldSettings;
  state: FieldState;
  palette: { paper: string; ink: string; accent: string };
}

/** Mixes two `#rrggbb` colours. */
function mix(a: string, b: string, t: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const channel = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[channel(ar, br), channel(ag, bg), channel(ab, bb)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function fieldToSvg({ width, height, settings, state, palette }: SvgOptions): string {
  const { cell } = settings;
  const cols = Math.max(1, Math.floor(width / cell));
  const rows = Math.max(1, Math.floor(height / cell));
  const offsetX = (width - cols * cell) / 2;
  const offsetY = (height - rows * cell) / 2;
  const ramp = GLYPH_SETS[settings.glyphs];
  const top = ramp.length - 1;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${palette.paper}"/>`,
  ];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const value = Math.max(0, Math.min(0.9999, sampleField(x, y, cols, rows, settings, state)));
      // Quantising through the ramp keeps the stepped look the glyphs give.
      const level = Math.floor(value * ramp.length);
      if (level <= 0) continue;

      const radius = (cell * 0.46 * level) / top;
      if (radius < 0.35) continue;

      const fill =
        settings.color === "accent"
          ? palette.accent
          : settings.color === "duotone"
            ? mix(palette.ink, palette.accent, value)
            : value > 0.86
              ? palette.accent
              : palette.ink;

      const cx = (offsetX + x * cell + cell / 2).toFixed(1);
      const cy = (offsetY + y * cell + cell / 2).toFixed(1);
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius.toFixed(2)}" fill="${fill}" opacity="${(0.18 + value * 0.82).toFixed(2)}"/>`,
      );
    }
  }

  parts.push("</svg>");
  return parts.join("");
}
