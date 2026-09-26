"use client";

import { RoomMenu } from "@/components/game/RoomMenu";
import { KEYS } from "@/components/game/storage";
import { JOIN_FLAG } from "./Room";

export function Menu({ multiplayer }: { multiplayer: boolean }) {
  return (
    <RoomMenu
      game={{ name: "draw", href: "/draw" }}
      api="/api/draw/rooms"
      seat={KEYS.drawRoom}
      joinFlag={JOIN_FLAG}
      multiplayer={multiplayer}
      intro="one of you draws a word, everyone else races to guess it in the chat. the quicker you guess, the more you score. everyone gets a turn to draw, for two to twelve players."
      how="each turn the drawer picks one of three words and has a minute or two to draw it, with a pen, a paint bucket and 24 colours. everyone else types guesses; a guess that's one letter off gets a nudge, and letters appear as hints as time runs down. the drawer scores for every person who gets it. the host can add their own words, like names everyone in the room knows."
      createHint="you'll get a code for your friends, and you pick the rounds and time."
    />
  );
}
