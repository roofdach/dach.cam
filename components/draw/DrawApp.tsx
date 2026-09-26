"use client";

import { Menu } from "./Menu";
import { Room } from "./Room";

/** /draw is the menu; /draw/CODE is a room. */
export default function DrawApp({ room, multiplayer }: { room?: string; multiplayer: boolean }) {
  return room ? <Room code={room} /> : <Menu multiplayer={multiplayer} />;
}
