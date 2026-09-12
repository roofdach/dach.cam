/** The curve maths behind the charts in `pulse`. Pure, and shared with the preview. */

import { lerp } from "../random.ts";

export interface Box {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * A centred moving average, used to calm long ranges down. The window is
 * clipped symmetrically at both ends, so the first point is treated the same
 * way as the last one.
 */
export function smooth(values: number[], window: number): number[] {
  if (window <= 1) return values;
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/**
 * Linearly resamples to a fixed number of points. Every range ends up with the
 * same number of path commands, which is what lets one curve morph into another
 * instead of being replaced.
 */
export function resample(values: number[], n: number): number[] {
  if (values.length === n) return values;
  if (values.length === 0) return new Array<number>(n).fill(0);
  if (values.length === 1) return new Array<number>(n).fill(values[0]);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(values.length - 1, lo + 1);
    out.push(lerp(values[lo], values[hi], t - lo));
  }
  return out;
}

/** A smoothed path through `points`, optionally closed into the baseline. */
export function buildPath(points: number[], box: Box, max: number, close: boolean): string {
  if (points.length < 2) return "";
  const innerW = box.width - box.left - box.right;
  const innerH = box.height - box.top - box.bottom;
  const x = (i: number) => box.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => box.top + innerH - (v / max) * innerH;

  let d = `M ${x(0).toFixed(1)} ${y(points[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const px = x(i);
    const py = y(points[i]);
    const prevX = x(i - 1);
    const prevY = y(points[i - 1]);
    const cx = (prevX + px) / 2;
    d += ` C ${cx.toFixed(1)} ${prevY.toFixed(1)} ${cx.toFixed(1)} ${py.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)}`;
  }
  if (close) {
    const base = (box.top + innerH).toFixed(1);
    d += ` L ${x(points.length - 1).toFixed(1)} ${base} L ${x(0).toFixed(1)} ${base} Z`;
  }
  return d;
}
