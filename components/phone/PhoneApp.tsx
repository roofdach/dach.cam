"use client";

import { Menu } from "./Menu";
import { Room } from "./Room";

/** /phone is the menu; /phone/CODE is a room. */
export default function PhoneApp({ room, multiplayer }: { room?: string; multiplayer: boolean }) {
  return room ? <Room code={room} /> : <Menu multiplayer={multiplayer} />;
}
