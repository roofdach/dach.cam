import { useId } from "react";

/**
 * The cookie, drawn once as an SVG so it stays sharp at any size. The golden
 * cookie is the same shape in a different metal.
 */

type Point = [number, number];

/** A closed, slightly lumpy shape: `wobble` nudges the radius at each angle. */
function blob(cx: number, cy: number, radius: number, wobble: (angle: number) => number, points: number): string {
  const at: Point[] = Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    const r = radius + wobble(angle);
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
  const mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const f = (n: number) => n.toFixed(1);
  const start = mid(at[points - 1], at[0]);
  let d = `M${f(start[0])} ${f(start[1])}`;
  at.forEach((p, i) => {
    const m = mid(p, at[(i + 1) % points]);
    d += `Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`;
  });
  return `${d}Z`;
}

const EDGE = blob(100, 100, 89, (a) => 2.4 * Math.sin(5 * a + 0.7) + 1.8 * Math.cos(9 * a + 1.3) + 1.1 * Math.sin(13 * a), 44);

const CHIPS = (
  [
    [60, 62, 9, 0.3],
    [112, 46, 8, 1.1],
    [150, 84, 10, 2.0],
    [100, 100, 9, 2.7],
    [54, 118, 10, 3.4],
    [132, 130, 9, 4.2],
    [88, 152, 8, 5.0],
    [146, 152, 7, 5.8],
    [126, 72, 6, 0.9],
    [36, 86, 6, 1.7],
  ] as const
).map(([x, y, size, phase]) => ({
  x,
  y,
  size,
  d: blob(x, y, size, (a) => size * 0.2 * Math.sin(3 * a + phase) + size * 0.12 * Math.cos(5 * a + phase * 2), 9),
}));

const PATCHES = [
  [80, 72, 20, 12, 20],
  [132, 108, 22, 13, -30],
  [70, 140, 17, 10, 40],
  [118, 162, 15, 8, -10],
  [150, 60, 12, 8, 60],
] as const;

const SPECKS = [
  [45, 92, 2],
  [95, 62, 1.6],
  [140, 60, 2.2],
  [162, 116, 1.8],
  [110, 124, 2],
  [66, 162, 1.6],
  [124, 178, 1.4],
  [34, 130, 1.8],
  [84, 120, 1.4],
  [100, 26, 1.8],
  [172, 96, 1.4],
  [58, 40, 1.6],
] as const;

const PALETTES = {
  cookie: {
    light: "#f5cf94",
    mid: "#dea35c",
    dark: "#b8733a",
    rim: "#955527",
    patch: "#a4622d",
    chip: "#4a2917",
    chipLight: "#7b4b2c",
    speck: "#fbe4b8",
  },
  golden: {
    light: "#fff6c9",
    mid: "#f7cf4f",
    dark: "#d99912",
    rim: "#a8700a",
    patch: "#c98a10",
    chip: "#b67a0c",
    chipLight: "#ffe27a",
    speck: "#ffffff",
  },
};

export function CookieArt({ variant = "cookie", className }: { variant?: keyof typeof PALETTES; className?: string }) {
  const id = `c${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const c = PALETTES[variant];
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-dough`} cx="42%" cy="38%" r="68%">
          <stop offset="0" stopColor={c.light} />
          <stop offset="0.58" stopColor={c.mid} />
          <stop offset="1" stopColor={c.dark} />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <path d={EDGE} />
        </clipPath>
      </defs>
      <path d={EDGE} fill={`url(#${id}-dough)`} />
      <g clipPath={`url(#${id}-clip)`}>
        {PATCHES.map(([x, y, rx, ry, rotate]) => (
          <ellipse
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            rx={rx}
            ry={ry}
            transform={`rotate(${rotate} ${x} ${y})`}
            fill={c.patch}
            opacity={0.2}
          />
        ))}
        <circle cx="100" cy="100" r="86" fill="none" stroke={c.rim} strokeWidth="7" opacity={0.28} />
        <ellipse cx="78" cy="62" rx="46" ry="30" fill="#ffffff" opacity={variant === "golden" ? 0.22 : 0.1} />
      </g>
      <path d={EDGE} fill="none" stroke={c.rim} strokeWidth="2.5" opacity={0.7} />
      {CHIPS.map((chip) => (
        <g key={`${chip.x}-${chip.y}`}>
          <path d={chip.d} fill={c.chip} />
          <ellipse
            cx={chip.x - chip.size * 0.3}
            cy={chip.y - chip.size * 0.32}
            rx={chip.size * 0.34}
            ry={chip.size * 0.22}
            fill={c.chipLight}
            opacity={0.75}
          />
        </g>
      ))}
      {SPECKS.map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={c.speck} opacity={0.6} />
      ))}
    </svg>
  );
}
