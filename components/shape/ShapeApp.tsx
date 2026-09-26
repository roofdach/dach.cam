"use client";

import { useSearchParams } from "next/navigation";
import { Classic } from "./Classic";
import { Menu } from "./Menu";
import { Quiz } from "./Quiz";
import { Room } from "./Room";
import { Speed } from "./Speed";

/** /shape is the menu, /shape?play=daily and the rest are the ways to play alone, and /shape/CODE is a race. */
export default function ShapeApp({ room, multiplayer }: { room?: string; multiplayer: boolean }) {
  const play = useSearchParams().get("play");
  if (room) return <Room code={room} />;
  if (play === "daily" || play === "practice") return <Classic key={play} mode={play} />;
  if (play === "speed") return <Speed />;
  if (play === "quiz") return <Quiz />;
  return <Menu multiplayer={multiplayer} />;
}
