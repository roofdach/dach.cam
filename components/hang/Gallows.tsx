import { LIVES } from "@/lib/hang/words";

/** Where each wrong guess draws the next piece: head, body, arms, legs. */
const PIECES = [
  { kind: "head", cx: 86, cy: 37, r: 11 },
  { kind: "line", d: "M86 48V86" },
  { kind: "line", d: "M86 58 70 74" },
  { kind: "line", d: "M86 58 102 74" },
  { kind: "line", d: "M86 86 72 110" },
  { kind: "line", d: "M86 86 100 110" },
] as const;

const GREEN = "text-[#2b8a3e] dark:text-[#69db7c]";

/**
 * A gallows and as much of the hangman as `misses` has drawn. Hanged, the
 * eyes cross; got it, the rope's cut and they're down on the ground,
 * cheering. Each new piece draws itself in, unless it's `still`.
 */
export function Gallows({
  misses,
  solved = false,
  still = false,
  className = "",
  label,
}: {
  misses: number;
  solved?: boolean;
  still?: boolean;
  className?: string;
  label?: string;
}) {
  const shown = Math.max(0, Math.min(LIVES, misses));
  const hanged = !solved && shown >= LIVES;
  const draw = still ? {} : { pathLength: 1, strokeDasharray: 1, className: "animate-draw-in" };
  const name = label ?? (solved ? "got it, and cut down" : hanged ? "hanged" : `${shown} of ${LIVES} wrong`);
  return (
    <svg viewBox="0 0 120 140" role="img" aria-label={name} className={`block ${className}`} fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 132H112M26 132V10H88M26 32 48 10" opacity={0.35} />
      <path d={solved ? "M86 10V19" : "M86 10V26"} opacity={0.35} />
      {solved ? (
        <g className={GREEN} key="saved">
          <circle cx={96} cy={76} r={10} {...draw} />
          <path d="M96 86V112M96 94 84 80M96 94 108 80M96 112 88 131M96 112 104 131" {...draw} />
          <path d="M91.5 78.5Q96 83 100.5 78.5" strokeWidth={3} />
          <circle cx={92.5} cy={73} r={0.6} strokeWidth={3} />
          <circle cx={99.5} cy={73} r={0.6} strokeWidth={3} />
        </g>
      ) : (
        <g className={hanged ? "text-accent" : undefined}>
          {PIECES.slice(0, shown).map((piece, i) =>
            piece.kind === "head" ? <circle key={i} cx={piece.cx} cy={piece.cy} r={piece.r} {...draw} /> : <path key={i} d={piece.d} {...draw} />,
          )}
          {hanged && <path d="M80 33l4 4M84 33l-4 4M88 33l4 4M92 33l-4 4M82 43h8" strokeWidth={2.5} />}
        </g>
      )}
    </svg>
  );
}
