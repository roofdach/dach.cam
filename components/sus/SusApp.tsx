"use client";

import { Menu } from "./Menu";
import { Room } from "./Room";

/** /sus is the menu; /sus/CODE is a room. */
export default function SusApp({ room, multiplayer }: { room?: string; multiplayer: boolean }) {
  return room ? <Room code={room} /> : <Menu multiplayer={multiplayer} />;
}
