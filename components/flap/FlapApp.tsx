"use client";

import { Menu } from "./Menu";
import { Room } from "./Room";

/** /flap is a bird to fly and the high scores; /flap/CODE is a race. */
export default function FlapApp({ room, multiplayer }: { room?: string; multiplayer: boolean }) {
  return room ? <Room code={room} /> : <Menu multiplayer={multiplayer} />;
}
