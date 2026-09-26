"use client";

import Link from "next/link";
import { useState } from "react";
import { dailyDate, dailyNumber } from "@/lib/shape/game";
import { RoomMenu } from "@/components/game/RoomMenu";
import { KEYS, load } from "@/components/game/storage";
import { JOIN_FLAG } from "./Room";

const isDone = (value: unknown): value is { key: string; guesses: string[] } =>
  !!value && typeof value === "object" && typeof (value as { key: unknown }).key === "string" && Array.isArray((value as { guesses: unknown }).guesses);

/** The front page: the four ways to play alone, then racing friends with a room code. */
export function Menu({ multiplayer }: { multiplayer: boolean }) {
  const [today] = useState(dailyDate);
  const [daily] = useState(() => {
    const saved = load(KEYS.shapeDaily, isDone);
    return saved?.key === today ? saved.guesses.length : 0;
  });
  const modes = [
    { play: "daily", title: `daily #${dailyNumber(today)}`, blurb: daily ? "carry on where you were, or see how you did" : "the same country for everyone today. six guesses." },
    { play: "practice", title: "practice", blurb: "as many as you like, same rules" },
    { play: "speed", title: "speed", blurb: "name as many as you can in a minute" },
    { play: "quiz", title: "quiz", blurb: "five countries: the shape, then the flag, capital and neighbours" },
  ];
  return (
    <RoomMenu
      game={{ name: "shape", href: "/shape" }}
      api="/api/shape/rooms"
      seat={KEYS.shapeRoom}
      joinFlag={JOIN_FLAG}
      multiplayer={multiplayer}
      intro="a worldle. you get a country's outline and guess which one it is; every wrong guess tells you how far off you are and which way to go."
      how="in a race, everyone sees the same outline at the same moment and types their guesses. wrong ones show you, and only you, how far off you are and which way. the sooner you get it, the more you score, and the round ends when everyone has it or time's up."
      createHint="you'll get a code for your friends, and you pick how many shapes and how long each gets."
      footer="outlines from natural earth. capitals from geonames (cc by 4.0). flags from country-flag-icons."
    >
      <ul className="mt-8 grid gap-2 sm:grid-cols-2">
        {modes.map((mode) => (
          <li key={mode.play}>
            <Link href={`/shape?play=${mode.play}`} className="block h-full rounded-xl border border-faint/70 p-4 transition-colors hover:border-ink/40 hover:bg-ink/[0.03]">
              <span className="block text-[15px] font-semibold">{mode.title}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{mode.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="mt-10 text-[15px] font-semibold">race your friends</h2>
    </RoomMenu>
  );
}
