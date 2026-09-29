"use client";

import { Menu } from "./Menu";
import { Room } from "./Room";

/** /snake is a snake to play and the high scores; /snake/CODE is a race. */
export default function SnakeApp({ room, multiplayer }: { room?: string; multiplayer: boolean }) {
  return room ? <Room code={room} /> : <Menu multiplayer={multiplayer} />;
}
