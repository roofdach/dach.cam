"use client";

import { RoomMenu } from "@/components/game/RoomMenu";
import { KEYS } from "@/components/game/storage";
import { Boards } from "@/components/arcade/Boards";
import { GameOver } from "@/components/arcade/GameOver";
import { useSolo } from "@/components/arcade/useSolo";
import { FlapCanvas } from "./Game";
import { JOIN_FLAG } from "./Room";

/** The front page: a bird to fly straight away, the high scores beside it, then racing a friend with a room code. */
export function Menu({ multiplayer }: { multiplayer: boolean }) {
  const solo = useSolo("flap");
  return (
    <RoomMenu
      game={{ name: "flap", href: "/flap" }}
      api="/api/flap/rooms"
      seat={(code) => KEYS.arcadeRoom("flap", code)}
      joinFlag={JOIN_FLAG}
      multiplayer={multiplayer}
      intro="a flappy bird. tap to flap, don't touch the pipes. every pipe you get through is a point, and the gaps close up as you go."
      how="in a race, everyone gets the same pipes at the same moment, and you see the others flying beside you. whoever gets furthest takes the round (the longest flight, if it's level); first to win so many rounds takes the match. every run is played back by the server before it counts, here and on the high scores."
      createHint="you'll get a code for your opponent, and you pick how many rounds to win."
    >
      <div className="mt-8 grid items-start gap-4 sm:grid-cols-[18rem_minmax(0,1fr)]">
        <FlapCanvas key={solo.run} seed={solo.seed} best={solo.best} onOver={({ flaps, bird }) => solo.over(flaps, bird.score)} onAgain={() => void solo.again()}>
          {solo.result && (
            <GameOver result={solo.result} best={solo.best} counts={solo.counts} word={solo.result.score === 1 ? "pipe" : "pipes"} onAgain={() => void solo.again()} onName={solo.nameAndSend} />
          )}
        </FlapCanvas>
        <Boards boards={solo.boards} me={solo.me} best={solo.best} unavailable={solo.unavailable} />
      </div>
      <h2 className="mt-10 text-[15px] font-semibold">race a friend</h2>
    </RoomMenu>
  );
}
