"use client";

import { plural } from "@/components/game/ui";
import { Versus, type VersusGame } from "@/components/arcade/Versus";
import { FlapRace } from "./Race";

/** Set by the menu when you type a code with your name already in, so you go straight in. */
export const JOIN_FLAG = "flap:join";

const GAME: VersusGame = {
  id: "flap",
  name: "flap",
  href: "/flap",
  joinFlag: JOIN_FLAG,
  rules: "everyone flies the same pipes at once; the most pipes takes the round.",
  scoreWord: (n) => plural(n, "pipe"),
  Play: FlapRace,
};

export function Room({ code }: { code: string }) {
  return <Versus game={GAME} code={code} />;
}
