import type { ReactNode } from "react";
import { HEIGHT, ROOM_IDS, SPOTS, TILE, WIDTH, ZONES, ZONE_IDS, type Point, type RoomId } from "@/lib/sus/ship";

/**
 * The ship from above, the way the map and admin's table show it: every
 * room and corridor, where you are, where your tasks are, and anything
 * that's wrong. Admin's table adds how many are in each room.
 */
export function ShipMap({
  me,
  tasks = [],
  sabotage = null,
  counts = null,
  children,
}: {
  me?: Point | null;
  tasks?: readonly Point[];
  sabotage?: "lights" | "reactor" | null;
  counts?: Partial<Record<RoomId, number>> | null;
  children?: ReactNode;
}) {
  const alarm = sabotage === "lights" ? [SPOTS.lights] : sabotage === "reactor" ? SPOTS.reactor : [];
  return (
    <svg viewBox={`-40 -40 ${WIDTH + 80} ${HEIGHT + 80}`} className="block h-auto w-full" role="img" aria-label="map of the ship">
      {ZONE_IDS.map((id) =>
        ZONES[id].boxes.map(([c, r, w, h], i) => (
          <rect key={`${id}:${i}`} x={c * TILE} y={r * TILE} width={w * TILE} height={h * TILE} fill={ZONES[id].room ? "#3f7fbf" : "#2f5f93"} stroke="#9fd0ff" strokeWidth={6} strokeOpacity={0.35} />
        )),
      )}
      {ROOM_IDS.map((id) => {
        const [c, r, w, h] = ZONES[id].boxes[0];
        const count = counts?.[id] ?? 0;
        return (
          <g key={id}>
            <text x={(c + w / 2) * TILE} y={(r + h / 2) * TILE - (counts ? 40 : 0)} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={62} fontWeight={700} opacity={0.9}>
              {ZONES[id].name}
            </text>
            {counts &&
              Array.from({ length: count }, (_, i) => (
                // Just a shape: the table can't tell who's who.
                <svg key={i} x={(c + w / 2) * TILE - (count * 70) / 2 + i * 70} y={(r + h / 2) * TILE + 5} width={64} height={70} viewBox="0 0 44 48">
                  <path d="M10 15a12 12 0 0 1 24 0V40a4 4 0 0 1-4 4h-4a2 2 0 0 1-2-2v-3h-4v3a2 2 0 0 1-2 2h-4a4 4 0 0 1-4-4Z" fill="#e9ecef" stroke="#15171a" strokeWidth={2.5} />
                  <path d="M25.5 10h8a5.5 5.5 0 0 1 0 11h-8a5.5 5.5 0 0 1 0-11Z" fill="#95cadc" stroke="#15171a" strokeWidth={2.5} />
                </svg>
              ))}
          </g>
        );
      })}
      {tasks.map((t, i) => (
        <g key={i} transform={`translate(${t.x} ${t.y})`}>
          <circle r={34} fill="#ffd43b" stroke="#15171a" strokeWidth={8} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={50} fontWeight={900} fill="#15171a">
            !
          </text>
        </g>
      ))}
      {alarm.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={60} fill="#ff3b3b" stroke="white" strokeWidth={8} className="animate-pulse" />
      ))}
      {me && <circle cx={me.x} cy={me.y} r={44} fill="#ff3b3b" stroke="white" strokeWidth={12} />}
      {children}
    </svg>
  );
}
