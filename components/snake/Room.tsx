"use client";

import { plural } from "@/components/game/ui";
import { Versus, type VersusGame } from "@/components/arcade/Versus";
import { SnakeRace } from "./Race";

/** Set by the menu when you type a code with your name already in, so you go straight in. */
export const JOIN_FLAG = "snake:join";

const GAME: VersusGame = {
  id: "snake",
  name: "snake",
  href: "/snake",
  joinFlag: JOIN_FLAG,
  rules: "everyone plays the same board at once, each their own snake; the most apples takes the round.",
  scoreWord: (n) => plural(n, "apple"),
  Play: SnakeRace,
};

export function Room({ code }: { code: string }) {
  return <Versus game={GAME} code={code} />;
}
