import { COLORS } from "@/lib/sus/ship";

const OUTLINE = "#15171a";

/**
 * A crewmate in their colour: body, backpack and visor. A ghost is see-
 * through; a body is what the impostor left, half of one with a bone.
 */
export function Bean({ color, dead = false, ghost = false, className = "", label }: { color: number; dead?: boolean; ghost?: boolean; className?: string; label?: string }) {
  const fill = COLORS[color % COLORS.length].hex;
  const shade = `color-mix(in oklab, ${fill} 70%, black)`;
  return (
    <svg viewBox="0 0 44 48" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={`block ${className}`} opacity={ghost ? 0.45 : 1}>
      {dead ? (
        <g stroke={OUTLINE} strokeWidth={2.5} strokeLinejoin="round">
          <path d="M20.5 28V19.5M23.5 28V19.5" stroke="#f1f3f5" strokeWidth={3} strokeLinecap="round" />
          <circle cx={20.5} cy={18.5} r={2.4} fill="#f1f3f5" strokeWidth={1.5} />
          <circle cx={23.5} cy={18.5} r={2.4} fill="#f1f3f5" strokeWidth={1.5} />
          <rect x={3} y={28} width={9} height={9} rx={3} fill={shade} />
          <path d="M10 28H34V40a4 4 0 0 1-4 4h-4a2 2 0 0 1-2-2v-3h-4v3a2 2 0 0 1-2 2h-4a4 4 0 0 1-4-4Z" fill={fill} />
          <path d="M11 28.5h22" stroke={shade} strokeWidth={3} />
        </g>
      ) : (
        <g stroke={OUTLINE} strokeWidth={2.5} strokeLinejoin="round">
          <rect x={3} y={17} width={9} height={17} rx={3.5} fill={shade} />
          <path d="M10 15a12 12 0 0 1 24 0V40a4 4 0 0 1-4 4h-4a2 2 0 0 1-2-2v-3h-4v3a2 2 0 0 1-2 2h-4a4 4 0 0 1-4-4Z" fill={fill} />
          <rect x={20} y={10} width={19} height={11} rx={5.5} fill="#95cadc" />
          <path d="M26 13.2h7" stroke="#e7f5fa" strokeWidth={2.2} strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

/** Someone's colour's name, which is how everyone will talk about them. */
export const colorName = (color: number) => COLORS[color % COLORS.length].name;
