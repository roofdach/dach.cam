"use client";

import { RoomMenu } from "@/components/game/RoomMenu";
import { KEYS } from "@/components/game/storage";
import { JOIN_FLAG } from "./Room";

export function Menu({ multiplayer }: { multiplayer: boolean }) {
  return (
    <RoomMenu
      game={{ name: "phone", href: "/phone" }}
      api="/api/phone/rooms"
      seat={KEYS.phoneRoom}
      joinFlag={JOIN_FLAG}
      multiplayer={multiplayer}
      intro="telephone, with drawing. everyone writes something, then it goes round: draw what the person before you wrote, write what the drawing before you shows, and so on. at the end you see how every sentence turned out. two to twelve players, best with four or more."
      how="everyone writes a sentence to start. it's passed on and the next person draws it; that drawing is passed on and the next person says what they think it is; and so on round the table, with a clock on each step. then the host shows each chain one step at a time, from the first sentence to wherever it ended up."
      createHint="you'll get a code for your friends, and you pick how fast it goes."
    />
  );
}
