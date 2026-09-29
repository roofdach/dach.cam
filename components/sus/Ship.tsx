"use client";

import type { KeyboardEvent } from "react";
import type { GameView, PlayerView } from "@/lib/sus/room";
import type { Mine } from "@/lib/sus/server/rooms";
import { CORRIDORS, ROOMS, ROOM_IDS, SPOTS, TASK_BY_ID, VENTS, center, exitsFrom, ventsFrom, type RoomId } from "@/lib/sus/ship";
import { Bean } from "./Bean";

const BEAN = 26;

type Figure = { id: string; as: "alive" | "ghost" | "body" };

/** Little crewmates in rows inside a room: whoever you can see, and any bodies. */
function Crowd({ room, figures, players }: { room: RoomId; figures: Figure[]; players: Map<string, PlayerView> }) {
  const box = ROOMS[room];
  const size = figures.length > 8 ? BEAN * 0.72 : BEAN;
  const perRow = Math.max(1, Math.floor((box.w - 12) / (size * 0.95)));
  return (
    <g>
      {figures.map(({ id, as }, i) => {
        const x = box.x + 8 + (i % perRow) * size * 0.95;
        const y = box.y + box.h - 8 - size * 1.1 * (Math.floor(i / perRow) + 1);
        return (
          <svg key={`${id}:${as}`} x={x} y={y} width={size} height={size * 1.1} viewBox="0 0 44 48" overflow="visible">
            <Bean color={players.get(id)?.color ?? 0} dead={as === "body"} ghost={as === "ghost"} />
          </svg>
        );
      })}
    </g>
  );
}

const figures = (ids: string[], as: Figure["as"]): Figure[] => ids.map((id) => ({ id, as }));

/**
 * The ship from above. Your room's lit up; the rooms you can get to from it
 * can be tapped, and for an impostor, the ones a vent goes to too. Rooms
 * with tasks of yours still to do have a mark; admin's table and the
 * cameras show what they can see, and an alarm flashes where it's fixed.
 */
export function Ship({
  self,
  me,
  players,
  sabotage,
  ready,
  dark = false,
  onMove,
}: {
  /** Your player id. */
  self: string;
  me: Mine | null;
  players: Map<string, PlayerView>;
  sabotage: GameView["sabotage"];
  /** Whether you can move now. */
  ready: boolean;
  /** The lights are out, for you. */
  dark?: boolean;
  onMove: (room: RoomId, vent: boolean) => void;
}) {
  const here = me?.room ?? null;
  const walk = new Set<RoomId>(me && here ? (me.alive ? exitsFrom(here) : ROOM_IDS.filter((r) => r !== here)) : []);
  const vent = new Set<RoomId>(me?.impostor && me.alive && here ? ventsFrom(here) : []);
  const todo = new Set(me?.tasks.filter((t) => !t.done).map((t) => TASK_BY_ID.get(t.id)!.room) ?? []);
  const alarm = sabotage ? SPOTS[sabotage.kind] : null;
  const camera = new Map(me?.cameras?.map((c) => [c.room, c]) ?? []);

  const go = (room: RoomId) => {
    if (!ready) return;
    if (walk.has(room)) onMove(room, false);
    else if (vent.has(room)) onMove(room, true);
  };

  return (
    <svg viewBox="0 0 1000 600" className="block h-auto w-full select-none" role="group" aria-label="the ship">
      <g stroke="var(--faint)" strokeWidth={18} strokeLinecap="round" opacity={0.55}>
        {CORRIDORS.map(([a, b]) => {
          const [p, q] = [center(a), center(b)];
          return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
        })}
      </g>
      {me?.impostor && (
        <g stroke="var(--accent)" strokeWidth={3} strokeDasharray="4 8" strokeLinecap="round" fill="none">
          {VENTS.map(([a, b]) => {
            const [p, q] = [center(a), center(b)];
            const mine = a === here || b === here;
            return <path key={`${a}~${b}`} d={`M${p.x} ${p.y}Q${(p.x + q.x) / 2} ${(p.y + q.y) / 2 - 40} ${q.x} ${q.y}`} opacity={mine ? 0.9 : 0.25} />;
          })}
        </g>
      )}
      {ROOM_IDS.map((id) => {
        const room = ROOMS[id];
        const mine = id === here;
        const reachable = walk.has(id) || vent.has(id);
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            go(id);
          }
        };
        const count = me?.table?.[id];
        const cam = camera.get(id);
        return (
          <g
            key={id}
            className={reachable && ready ? "group cursor-pointer" : "group"}
            onClick={reachable ? () => go(id) : undefined}
            onKeyDown={reachable ? onKey : undefined}
            role={reachable ? "button" : undefined}
            tabIndex={reachable ? 0 : undefined}
            aria-label={reachable ? `${vent.has(id) && !walk.has(id) ? "vent to" : "go to"} ${room.name}` : undefined}
            aria-disabled={reachable && !ready ? true : undefined}
          >
            <rect x={room.x} y={room.y} width={room.w} height={room.h} rx={14} fill={dark ? "#1b1d22" : "var(--paper)"} />
            <rect
              x={room.x}
              y={room.y}
              width={room.w}
              height={room.h}
              rx={14}
              strokeWidth={mine ? 4 : 2}
              className={`transition-colors ${
                mine
                  ? "fill-accent/15 stroke-accent"
                  : reachable
                    ? `fill-transparent stroke-ink/45 ${ready ? "group-hover:fill-ink/10 group-focus-visible:fill-ink/10" : ""}`
                    : "fill-transparent stroke-faint"
              } ${alarm === id ? "animate-pulse stroke-accent" : ""}`}
              strokeDasharray={vent.has(id) && !walk.has(id) ? "8 6" : undefined}
            />
            <text x={room.x + 12} y={room.y + 26} fontSize={19} className={mine ? "fill-accent font-semibold" : dark ? "fill-white/45" : reachable ? "fill-ink" : "fill-muted"}>
              {room.name}
            </text>
            {todo.has(id) && (
              <g aria-label="a task of yours">
                <circle cx={room.x + room.w - 16} cy={room.y + 18} r={11} fill="#f5c000" stroke="#15171a" strokeWidth={2} />
                <text x={room.x + room.w - 16} y={room.y + 25} fontSize={17} fontWeight={700} textAnchor="middle" fill="#15171a">
                  !
                </text>
              </g>
            )}
            {count !== undefined && !mine && (
              <g>
                <circle cx={room.x + room.w / 2} cy={room.y + room.h / 2 + 8} r={17} className="fill-ink" />
                <text x={room.x + room.w / 2} y={room.y + room.h / 2 + 15} fontSize={20} fontWeight={700} textAnchor="middle" className="fill-paper">
                  {count}
                </text>
              </g>
            )}
            {cam && !mine && <Crowd room={id} figures={[...figures(cam.players, "alive"), ...figures(cam.bodies, "body")]} players={players} />}
          </g>
        );
      })}
      {me && here && (
        <Crowd
          room={here}
          figures={[{ id: self, as: me.alive ? "alive" : "ghost" }, ...figures(me.here, "alive"), ...figures(me.ghosts, "ghost"), ...figures(me.bodies, "body")]}
          players={players}
        />
      )}
    </svg>
  );
}
