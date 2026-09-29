"use client";

import { RoomMenu } from "@/components/game/RoomMenu";
import { KEYS } from "@/components/game/storage";
import { Gallows } from "./Gallows";
import { JOIN_FLAG } from "./Room";

export function Menu({ multiplayer }: { multiplayer: boolean }) {
  return (
    <RoomMenu
      game={{ name: "hang", href: "/hang" }}
      api="/api/hang/rooms"
      seat={KEYS.hangRoom}
      joinFlag={JOIN_FLAG}
      multiplayer={multiplayer}
      intro="a hangman for a room. everyone gets the same hidden word at once and guesses letters on their own board; six wrong and you're hanged. get it first to win the most."
      how="each word comes with a clue, like “animals” or “space”. guess letters by tapping them or typing; a right one shows everywhere it comes, a wrong one draws another piece of you. have a go at the whole word whenever you're sure, but a wrong go costs a piece too. you can watch everyone else's hangman as they go. in a race the game picks the words; taking turns, each of you picks one for everyone else and scores for every piece they lose. the host can add words of their own, like names everyone in the room knows."
      createHint="you'll get a code for your friends, and you pick the mode, how many words and how long each gets."
    >
      <div aria-hidden className="mt-8 flex items-end gap-3">
        {[0, 2, 4, 6].map((misses) => (
          <Gallows key={misses} misses={misses} className="h-20 w-auto text-ink" still />
        ))}
        <Gallows misses={3} solved className="h-20 w-auto text-ink" still />
      </div>
    </RoomMenu>
  );
}
