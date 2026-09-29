"use client";

import { RoomMenu } from "@/components/game/RoomMenu";
import { KEYS } from "@/components/game/storage";
import { Bean } from "./Bean";
import { JOIN_FLAG } from "./Room";

export function Menu({ multiplayer }: { multiplayer: boolean }) {
  return (
    <RoomMenu
      game={{ name: "sus", href: "/sus" }}
      api="/api/sus/rooms"
      seat={KEYS.susRoom}
      joinFlag={JOIN_FLAG}
      multiplayer={multiplayer}
      intro="an among us, for four to fifteen. everyone's crew but the impostors, and only they know who they are. do your tasks, watch your back, and vote off whoever's sus."
      how="you walk about the ship (WASD, the arrow keys, or drag on a phone) and only see what's in your line of sight. crewmates do little tasks round the ship; impostors pretend to, kill whoever they catch alone, sneak through vents, and sabotage the lights or the reactor. anyone who finds a body, or presses the button on the cafeteria table, calls a meeting: talk it over in the chat, then vote. the crew win by finishing every task or voting off every impostor; the impostors, once they're as many as the crew. it's best with everyone in one room, or on a call."
      createHint="you'll get a code for your friends, and you pick the impostors, the kill cooldown, the tasks and how long meetings are."
    >
      <div aria-hidden className="mt-8 flex items-end gap-1">
        {[0, 1, 2, 3, 4, 5].map((color) => (
          <Bean key={color} color={color} className="h-14 w-auto" />
        ))}
        <Bean color={6} dead className="h-14 w-auto" />
      </div>
    </RoomMenu>
  );
}
