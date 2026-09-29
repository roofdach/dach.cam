"use client";

import { Menu } from "./Menu";
import { Room } from "./Room";

/** /hang is the menu; /hang/CODE is a room. */
export default function HangApp({ room, multiplayer }: { room?: string; multiplayer: boolean }) {
  return room ? <Room code={room} /> : <Menu multiplayer={multiplayer} />;
}
