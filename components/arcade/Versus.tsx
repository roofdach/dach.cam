"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import type { ArcadeGame } from "@/lib/arcade/games";
import { MIN_PLAYERS, TO_CHOICES, type RoomView, type RoundView } from "@/lib/arcade/room";
import { useServerNow } from "@/components/game/clock";
import { Connecting, ErrorLine, JoinForm, Leave, RoomGone, Shell, useAutoJoin, type GameName } from "@/components/game/room-ui";
import { Button, Choice, plural } from "@/components/game/ui";
import { useVersusRoom, type Snapshot, type VersusClient } from "./versus-client";

/**
 * A versus room's screens, the same for every arcade game: the lobby, the
 * round (whatever the game draws, with a countdown over it), who won it,
 * and who won the match. The game itself comes in as `Play`.
 */

export interface PlayProps {
  round: RoundView;
  me: string;
  names: Map<string, string>;
  /** Whether you're in this round, rather than watching. */
  playing: boolean;
  /** Whether the server has your run. */
  finished: boolean;
  client: VersusClient;
}

export interface VersusGame extends GameName {
  id: ArcadeGame;
  /** Set by the menu when you type a code with your name already in. */
  joinFlag: string;
  /** What winning a round means, for the lobby. */
  rules: ReactNode;
  /** A score in words: "12 pipes", "30 apples". */
  scoreWord: (n: number) => string;
  Play: ComponentType<PlayProps>;
}

export function Versus({ game, code }: { game: VersusGame; code: string }) {
  const [snapshot, client] = useVersusRoom(game.id, code);
  const { status, view, me } = snapshot;
  useAutoJoin(game.joinFlag, code, snapshot, client);
  const gone = RoomGone({ game, code, status });
  if (gone) return gone;
  if (!view) return <Connecting game={game} code={code} />;
  const seated = me !== null && view.players.some((p) => p.id === me && p.active);
  if (!seated) {
    const note = view.phase === "countdown" || view.phase === "playing" ? "a round's on; you'll be in the next one." : "";
    return <JoinForm game={game} code={code} players={view.players} note={note} snapshot={snapshot} client={client} />;
  }
  if (view.phase === "lobby") return <Lobby game={game} view={view} me={me!} snapshot={snapshot} client={client} />;
  if (view.phase === "countdown" || view.phase === "playing") return <Round game={game} view={view} me={me!} snapshot={snapshot} client={client} />;
  return <Results game={game} view={view} me={me!} snapshot={snapshot} client={client} />;
}

const namesOf = (view: RoomView) => new Map(view.players.map((p) => [p.id, p.name]));
const nameOf = (view: RoomView, id: string | null, me: string) => (id === me ? "you" : (view.players.find((p) => p.id === id)?.name ?? "someone"));

function Settings({ view, me, snapshot, client }: { view: RoomView; me: string; snapshot: Snapshot; client: VersusClient }) {
  const host = view.host === me;
  return (
    <div role="group" aria-label="first to" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[12.5px] text-muted">first to</span>
      {TO_CHOICES.map((to) => (
        <Choice key={to} selected={view.settings.to === to} onSelect={() => void client.act("settings", { settings: { to } })} disabled={!host || snapshot.busy}>
          {plural(to, "round")}
        </Choice>
      ))}
    </div>
  );
}

function Players({ view, me, client, results }: { view: RoomView; me: string; client: VersusClient; results?: boolean }) {
  const host = view.host === me;
  const players = view.players.filter((p) => p.active || p.wins > 0);
  return (
    <ul className="mt-3 space-y-1.5">
      {players.map((p) => (
        <li key={p.id} className="flex items-center gap-2 text-[14px]">
          <span className={`min-w-0 flex-1 truncate ${p.active ? "" : "text-muted line-through"}`}>
            {p.name}
            {p.id === me && <span className="ml-1 text-muted">(you)</span>}
            {p.id === view.host && <span className="ml-1 text-[12px] text-muted">host</span>}
            {p.away && <span className="ml-1 text-[12px] text-muted">away</span>}
          </span>
          {(results || p.wins > 0) && (
            <span className="font-mono text-[13px] tabular-nums" aria-label={`${p.wins} rounds won`}>
              {"●".repeat(p.wins)}
              <span className="text-faint">{"○".repeat(Math.max(0, view.settings.to - p.wins))}</span>
            </span>
          )}
          {host && p.id !== me && p.active && (
            <button type="button" onClick={() => void client.act("kick", { target: p.id })} className="text-[12px] text-muted hover:text-accent" aria-label={`remove ${p.name}`}>
              remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Lobby({ game, view, me, snapshot, client }: { game: VersusGame; view: RoomView; me: string; snapshot: Snapshot; client: VersusClient }) {
  const host = view.host === me;
  const active = view.players.filter((p) => p.active);
  const hostName = active.find((p) => p.id === view.host)?.name ?? "the host";
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? view.code : `${window.location.origin}${game.href}/${view.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  };
  const enough = active.length >= MIN_PLAYERS;
  return (
    <Shell game={game} code={view.code}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12.5px] text-muted">room code</p>
          <h1 className="font-mono text-[44px] font-semibold leading-none tracking-[0.2em]">{view.code}</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void copy("code")}>{copied === "code" ? "copied" : "copy code"}</Button>
          <Button tone="quiet" onClick={() => void copy("link")}>
            {copied === "link" ? "link copied" : "copy link"}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-muted">
        your opponent goes to <span className="text-ink">{window.location.host}{game.href}</span> and types the code.
      </p>
      <section aria-labelledby="players" className="mt-10">
        <h2 id="players" className="text-muted">
          {plural(active.length, "player")} <span className="text-faint">· two to eight</span>
        </h2>
        <Players view={view} me={me} client={client} />
      </section>
      <section className="mt-8">
        <Settings view={view} me={me} snapshot={snapshot} client={client} />
        <p className="mt-2 text-[12.5px] text-muted">{game.rules}</p>
      </section>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {host ? (
          <>
            <Button tone="solid" onClick={() => void client.act("start")} disabled={!enough || snapshot.busy} className="min-h-10 px-5">
              start
            </Button>
            {!enough && <span className="text-muted">waiting for someone to play against…</span>}
          </>
        ) : (
          <p className="text-muted">waiting for {hostName} to start…</p>
        )}
        <span className="flex-1" />
        <Leave game={game} client={client} />
      </div>
      <ErrorLine snapshot={snapshot} client={client} />
    </Shell>
  );
}

function Round({ game, view, me, snapshot, client }: { game: VersusGame; view: RoomView; me: string; snapshot: Snapshot; client: VersusClient }) {
  const match = view.match!;
  const round = match.round;
  const now = useServerNow(100);
  const left = Math.ceil((round.startAt - now) / 1000);
  const playing = round.players.includes(me);
  const finished = !!round.results[me];
  const { Play } = game;
  const waiting = round.players.filter((id) => !round.results[id] && view.players.find((p) => p.id === id)?.active);
  return (
    <div className="mx-auto w-full max-w-[52rem] px-3 py-4 text-[14px] sm:px-6 sm:py-8">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-[13px] text-muted">
          <span className="font-mono text-ink">{view.code}</span> · round {round.index} · first to {match.to}
        </p>
        <span className="flex-1" />
        <p className="text-[13px] text-muted">
          {view.players
            .filter((p) => round.players.includes(p.id))
            .map((p) => `${p.id === me ? "you" : p.name} ${p.wins}`)
            .join(" · ")}
        </p>
      </div>
      <div className="relative">
        <Play round={round} me={me} names={namesOf(view)} playing={playing} finished={finished} client={client} />
        {left > 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span key={left} className="animate-pop text-[96px] font-black text-white [text-shadow:0_4px_0_#000,0_0_24px_rgba(0,0,0,0.5)]">
              {left}
            </span>
          </div>
        )}
      </div>
      <p className="mt-3 text-center text-[13px] text-muted">
        {!playing
          ? "you're watching this one; you'll be in the next."
          : finished && waiting.length
            ? `you're out. waiting for ${waiting.map((id) => nameOf(view, id, me)).join(" and ")}…`
            : ""}
      </p>
      <ErrorLine snapshot={snapshot} client={client} />
    </div>
  );
}

function Results({ game, view, me, snapshot, client }: { game: VersusGame; view: RoomView; me: string; snapshot: Snapshot; client: VersusClient }) {
  const match = view.match!;
  const round = match.round;
  const host = view.host === me;
  const hostName = view.players.find((p) => p.id === view.host)?.name ?? "the host";
  const over = view.phase === "over";
  const ranked = round.players
    .map((id) => ({ id, result: round.results[id] }))
    .sort((a, b) => (b.result?.score ?? -1) - (a.result?.score ?? -1) || (b.result?.length ?? -1) - (a.result?.length ?? -1));
  const enough = view.players.filter((p) => p.active).length >= MIN_PLAYERS;
  const headline = over
    ? match.winner === me
      ? "you win the match!"
      : `${nameOf(view, match.winner, me)} wins the match`
    : round.winner === null
      ? "a draw"
      : round.winner === me
        ? "you take the round!"
        : `${nameOf(view, round.winner, me)} takes the round`;
  return (
    <Shell game={game} code={view.code}>
      <p className="text-[12.5px] text-muted">round {round.index}</p>
      <h1 className={`animate-pop text-[30px] font-black tracking-tight ${over && match.winner === me ? "text-[#2f9e44]" : ""}`}>{headline}</h1>
      <ol className="mt-5 space-y-1.5">
        {ranked.map(({ id, result }, i) => (
          <li key={id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${id === round.winner ? "bg-ink/[0.07] font-semibold" : ""}`}>
            <span className="w-5 font-mono text-[12px] text-muted">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{nameOf(view, id, me)}</span>
            <span className="font-mono tabular-nums">{result ? game.scoreWord(result.score) : "didn't finish"}</span>
          </li>
        ))}
      </ol>
      <section aria-labelledby="match" className="mt-8">
        <h2 id="match" className="text-muted">
          the match {over ? "" : `· first to ${match.to}`}
        </h2>
        <Players view={view} me={me} client={client} results />
      </section>
      {over && (
        <div className="mt-6">
          <Settings view={view} me={me} snapshot={snapshot} client={client} />
        </div>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {host ? (
          <Button tone="solid" onClick={() => void client.act("start")} disabled={!enough || snapshot.busy} className="min-h-10 px-5">
            {over ? "new match" : "next round"}
          </Button>
        ) : (
          <p className="text-muted">waiting for {hostName} to start the {over ? "next match" : "next round"}…</p>
        )}
        {host && !enough && <span className="text-muted">your opponent left.</span>}
        <span className="flex-1" />
        <Leave game={game} client={client} />
      </div>
      <ErrorLine snapshot={snapshot} client={client} />
    </Shell>
  );
}
