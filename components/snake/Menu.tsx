"use client";

import { RoomMenu } from "@/components/game/RoomMenu";
import { KEYS } from "@/components/game/storage";
import { Boards } from "@/components/arcade/Boards";
import { GameOver } from "@/components/arcade/GameOver";
import { useSolo } from "@/components/arcade/useSolo";
import { SnakeCanvas } from "./Game";
import { JOIN_FLAG } from "./Room";

/** The front page: a snake to play straight away, the high scores under it, then racing a friend with a room code. */
export function Menu({ multiplayer }: { multiplayer: boolean }) {
  const solo = useSolo("snake");
  return (
    <RoomMenu
      game={{ name: "snake", href: "/snake" }}
      api="/api/snake/rooms"
      seat={(code) => KEYS.arcadeRoom("snake", code)}
      joinFlag={JOIN_FLAG}
      multiplayer={multiplayer}
      intro="a snake. eat the apples, don't hit the walls or yourself. you get longer and faster with every apple, and every fifth brings a golden one, worth three, for a little while."
      how="in a race, everyone gets the same board and the same first apple at the same moment, and plays their own snake, with everyone else's boards beside yours as they go. the most apples takes the round (the longest game, if it's level); first to win so many rounds takes the match. every game is played back by the server before it counts, here and on the high scores."
      createHint="you'll get a code for your opponent, and you pick how many rounds to win."
    >
      <div className="mt-8 space-y-4">
        <SnakeCanvas key={solo.run} seed={solo.seed} best={solo.best} onOver={({ turns, snake }) => solo.over(turns, snake.score)} onAgain={() => void solo.again()}>
          {solo.result && (
            <GameOver result={solo.result} best={solo.best} counts={solo.counts} word={solo.result.score === 1 ? "apple" : "apples"} onAgain={() => void solo.again()} onName={solo.nameAndSend} />
          )}
        </SnakeCanvas>
        <Boards boards={solo.boards} me={solo.me} best={solo.best} unavailable={solo.unavailable} />
      </div>
      <h2 className="mt-10 text-[15px] font-semibold">race a friend</h2>
    </RoomMenu>
  );
}
