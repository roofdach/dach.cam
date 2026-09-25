"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { dailyDate } from "@/lib/geo/daily";
import { Menu } from "./Menu";
import { Room } from "./Room";
import { Solo, clearSolo, isSoloGame, type SoloGame } from "./Solo";
import { KEYS, load, save } from "./storage";

/**
 * Which screen is up lives in the address: /geo is the menu, /geo?play=solo
 * and /geo?play=daily are a game in progress (kept in localStorage), and
 * /geo/CODE is a room. So a refresh lands you back where you were, and the
 * back button goes back to the menu.
 */
export default function GeoApp({ room, multiplayer, streetView }: { room?: string; multiplayer: boolean; streetView: boolean }) {
  const router = useRouter();
  const mode = useSearchParams().get("play");
  const [autostart, setAutostart] = useState(false);
  const [game] = useSavedGame(mode, room);

  // An address for a game that isn't saved (anymore) falls back to the menu.
  useEffect(() => {
    if (!room && mode && !game) router.replace("/geo");
  }, [room, mode, game, router]);

  const play = useCallback(
    (next: SoloGame) => {
      save(next.kind === "daily" ? KEYS.daily : KEYS.solo, next);
      setAutostart(false);
      router.push(`/geo?play=${next.kind}`);
    },
    [router],
  );

  const exit = useCallback(() => {
    // A finished game has nothing to carry on.
    if (load(KEYS.solo, isSoloGame)?.phase === "done") clearSolo();
    router.push("/geo");
  }, [router]);

  if (room) return <Room code={room} streetView={streetView} />;

  if (game) {
    return (
      <Solo
        key={`${game.kind}:${game.places[0]?.pano}`}
        initial={game}
        onExit={exit}
        onAgain={
          game.kind === "solo"
            ? () => {
                clearSolo();
                setAutostart(true);
                router.replace("/geo");
              }
            : undefined
        }
      />
    );
  }

  return <Menu multiplayer={multiplayer} streetView={streetView} autostart={autostart} onPlay={play} />;
}

/** The saved game the address asks for, read once per change of address. */
function useSavedGame(mode: string | null, room?: string): [SoloGame | null] {
  const [state, setState] = useState<{ mode: string | null; game: SoloGame | null }>(() => ({ mode, game: read(mode, room) }));
  if (state.mode !== mode) {
    const next = { mode, game: read(mode, room) };
    setState(next);
    return [next.game];
  }
  return [state.game];
}

function read(mode: string | null, room?: string): SoloGame | null {
  if (room) return null;
  if (mode === "solo") return load(KEYS.solo, isSoloGame);
  if (mode === "daily") {
    const daily = load(KEYS.daily, isSoloGame);
    return daily?.date === dailyDate() ? daily : null;
  }
  return null;
}
