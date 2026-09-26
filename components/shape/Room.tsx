"use client";

import { useMemo, useState } from "react";
import { BY_CODE, MAX_GUESSES } from "@/lib/shape/game";
import { ROUND_CHOICES, TIME_CHOICES, type PlayerView, type RoomView } from "@/lib/shape/room";
import { useServerNow } from "@/components/game/clock";
import { Connecting, Crumbs, ErrorLine, JoinForm, Leave, RoomGone, Shell, useAutoJoin, type GameName } from "@/components/game/room-ui";
import { Button, Choice, ordinal, plural } from "@/components/game/ui";
import { CountryInput, Flag, HintRow, Outline } from "./parts";
import { useShapeRoom, type ShapeClient, type Snapshot } from "./room-client";

/** Set by the menu when you type a code with your name already in, so you go straight in. */
export const JOIN_FLAG = "shape:join";

const GAME: GameName = { name: "shape", href: "/shape" };

export function Room({ code }: { code: string }) {
  const [snapshot, client] = useShapeRoom(code);
  const { status, view, me } = snapshot;
  useAutoJoin(JOIN_FLAG, code, snapshot, client);

  const gone = RoomGone({ game: GAME, code, status });
  if (gone) return gone;
  if (!view) return <Connecting game={GAME} code={code} />;

  const seated = me !== null && view.players.some((p) => p.id === me && p.active);
  if (!seated) {
    const note = view.game && view.game.phase !== "final" ? "a race is on; you'll join straight in." : "";
    return <JoinForm game={GAME} code={code} players={view.players} note={note} snapshot={snapshot} client={client} />;
  }
  if (!view.game) return <Lobby view={view} me={me!} snapshot={snapshot} client={client} />;
  return <Race view={view} me={me!} snapshot={snapshot} client={client} />;
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

/* --------------------------------------------------------------- lobby */

function Lobby({ view, me, snapshot, client }: { view: RoomView; me: string; snapshot: Snapshot; client: ShapeClient }) {
  const host = view.host === me;
  const players = view.players.filter((p) => p.active);
  const hostName = players.find((p) => p.id === view.host)?.name ?? "the host";
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? view.code : `${window.location.origin}/shape/${view.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  };
  const change = (patch: Partial<RoomView["settings"]>) => void client.act("settings", { settings: { ...view.settings, ...patch } });

  return (
    <Shell game={GAME} code={view.code}>
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
        friends go to <span className="text-ink">{window.location.host}/shape</span> and type the code.
      </p>

      <section aria-labelledby="players" className="mt-10">
        <h2 id="players" className="text-muted">
          {plural(players.length, "player")}
        </h2>
        <ul className="mt-3 space-y-1.5">
          {players.map((player) => (
            <li key={player.id} className="flex items-center gap-2.5">
              <Dot color={player.color} />
              <span className="min-w-0 truncate">{player.name}</span>
              {player.id === me && <span className="text-muted">(you)</span>}
              {player.id === view.host && <span className="rounded bg-ink/[0.07] px-1.5 text-[11.5px] text-muted">host</span>}
              {player.away && <span className="text-[12px] text-muted">away</span>}
              <span className="flex-1" />
              {host && player.id !== me && (
                <button type="button" onClick={() => void client.act("kick", { target: player.id })} className="text-[12.5px] text-muted hover:text-accent">
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="settings" className="mt-10">
        <h2 id="settings" className="text-muted">
          race {host ? "" : `· ${hostName} picks`}
        </h2>
        <div className="mt-3 space-y-4">
          <div role="group" aria-label="shapes" className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-muted">shapes</span>
            <div className="flex flex-wrap gap-1.5">
              {ROUND_CHOICES.map((rounds) => (
                <Choice key={rounds} selected={view.settings.rounds === rounds} onSelect={() => change({ rounds })} disabled={!host || snapshot.busy}>
                  {rounds}
                </Choice>
              ))}
            </div>
          </div>
          <div role="group" aria-label="time for each" className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-muted">time for each</span>
            <div className="flex flex-wrap gap-1.5">
              {TIME_CHOICES.map((time) => (
                <Choice key={time} selected={view.settings.time === time} onSelect={() => change({ time })} disabled={!host || snapshot.busy}>
                  {time}s
                </Choice>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        {host ? (
          <Button tone="solid" onClick={() => void client.act("start")} disabled={snapshot.busy} className="min-h-10 px-5">
            start the race
          </Button>
        ) : (
          <p className="text-muted">waiting for {hostName} to start…</p>
        )}
        <span className="flex-1" />
        <Leave game={GAME} client={client} />
      </div>
      <ErrorLine snapshot={snapshot} client={client} />
    </Shell>
  );
}

/* ---------------------------------------------------------------- race */

function standings(players: PlayerView[]) {
  const rows = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows.map((player) => ({ player, rank: rows.findIndex((r) => r.score === player.score) + 1 }));
}

function Race({ view, me, snapshot, client }: { view: RoomView; me: string; snapshot: Snapshot; client: ShapeClient }) {
  const game = view.game!;
  const now = useServerNow(250);
  const host = view.host === me;
  const left = Math.max(0, Math.ceil((game.ends - now) / 1000));
  const mine = snapshot.mine && snapshot.mine.game === game.index && snapshot.mine.round === game.round ? snapshot.mine : null;
  const solvedByMe = game.solved.find((s) => s.p === me);
  const tries = game.tries[me] ?? 0;
  const out = !solvedByMe && tries >= MAX_GUESSES;
  const guessed = useMemo(() => new Set(mine?.hints.map((h) => h.code) ?? []), [mine]);

  if (game.phase === "final") return <Final view={view} me={me} host={host} snapshot={snapshot} client={client} />;

  return (
    <div className="flex min-h-dvh flex-col text-[14px]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-faint/50 px-3 py-2 sm:gap-x-4 sm:px-4">
        <Crumbs game={GAME} code={view.code} compact />
        <span className="text-[13px] text-muted">{game.phase === "countdown" ? "get ready" : `shape ${game.round + 1} of ${game.rounds}`}</span>
        <span className="flex-1" />
        {game.phase === "playing" && (
          <span aria-label={`${left} seconds left`} className={`font-mono text-[20px] font-semibold tabular-nums ${left <= 5 ? "text-accent" : ""}`}>
            {left}
          </span>
        )}
        <Leave game={GAME} client={client} label="leave" />
      </header>

      <main className="mx-auto grid w-full max-w-[60rem] flex-1 gap-6 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section className="min-w-0">
          {game.phase === "countdown" ? (
            <div className="grid h-[min(42vh,340px)] place-items-center rounded-2xl bg-ink/[0.035]">
              <p className="text-center">
                <span className="block text-[13px] text-muted">first shape in</span>
                <span className="block font-mono text-[64px] font-semibold leading-none tabular-nums">{left}</span>
              </p>
            </div>
          ) : (
            <div className="relative grid place-items-center rounded-2xl bg-ink/[0.035] p-4">
              {game.shape && <Outline key={`${game.index}.${game.round}`} shape={game.shape} className="h-[min(38vh,320px)] w-full text-ink animate-fade-in" />}
              {game.phase === "reveal" && game.answer && (
                <div className="absolute inset-x-3 bottom-3 animate-fade-in rounded-xl bg-paper/95 px-4 py-3 text-center shadow-lg">
                  <p className="text-[12.5px] text-muted">it was</p>
                  <p className="flex items-center justify-center gap-2 text-[20px] font-semibold">
                    <Flag code={game.answer} className="h-5" />
                    {BY_CODE.get(game.answer)?.name}
                  </p>
                  <p className="text-[12.5px] text-muted">{game.round + 1 < game.rounds ? `next shape in ${left}` : "that's the last one"}</p>
                </div>
              )}
            </div>
          )}

          {game.phase === "playing" && (
            <div className="mt-4">
              {solvedByMe ? (
                <p className="rounded-xl bg-[#d3f9d8] px-4 py-3 text-center font-semibold text-[#2b8a3e] dark:bg-[#1f3d25] dark:text-[#8ce99a]">
                  got it! +{solvedByMe.points}
                </p>
              ) : out ? (
                <p className="rounded-xl bg-ink/[0.05] px-4 py-3 text-center text-muted">out of guesses for this one</p>
              ) : (
                <CountryInput key={`${game.index}.${game.round}`} onGuess={(c) => void client.guess(c.code)} exclude={guessed} disabled={snapshot.busy} placeholder="which country is this?" />
              )}
            </div>
          )}
          {mine && mine.hints.length > 0 && (
            <ol className="mt-3 space-y-1.5">
              {mine.hints.map((hint) => (
                <HintRow key={hint.code} hint={hint} />
              ))}
            </ol>
          )}
          <ErrorLine snapshot={snapshot} client={client} />
        </section>

        <aside aria-label="players" className="min-w-0">
          <ol className="space-y-1">
            {standings(view.players).map(({ player, rank }) => {
              const solved = game.solved.find((s) => s.p === player.id);
              const theirTries = game.tries[player.id] ?? 0;
              return (
                <li
                  key={player.id}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${solved ? "bg-[#d3f9d8] dark:bg-[#1f3d25]" : "bg-ink/[0.035]"} ${player.active ? "" : "opacity-50"}`}
                >
                  <span className="w-6 shrink-0 font-mono text-[12px] text-muted">#{rank}</span>
                  <Dot color={player.color} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {player.name}
                    {player.id === me && <span className="font-normal text-muted"> (you)</span>}
                  </span>
                  <span className="text-[12px] text-muted">
                    {solved ? `+${solved.points}` : game.phase === "playing" && theirTries > 0 ? `${theirTries}/${MAX_GUESSES}` : ""}
                  </span>
                  <span className="w-12 text-right font-mono text-[13px] tabular-nums">{player.score}</span>
                </li>
              );
            })}
          </ol>
          {game.phase === "playing" && (
            <p className="mt-2 text-[12px] text-muted">
              {game.solved.length} of {plural(view.players.filter((p) => p.active).length, "player")} got it
            </p>
          )}
          {host && <EndGame client={client} />}
        </aside>
      </main>
    </div>
  );
}

function EndGame({ client }: { client: ShapeClient }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="mt-4">
      {asking ? (
        <span className="flex items-center gap-2 text-[13px]">
          end it for everyone?
          <Button onClick={() => setAsking(false)}>no</Button>
          <Button tone="solid" onClick={() => void client.act("lobby")}>
            end
          </Button>
        </span>
      ) : (
        <Button tone="quiet" onClick={() => setAsking(true)}>
          end the race
        </Button>
      )}
    </div>
  );
}

const PODIUM = ["#e8b923", "#9aa1a9", "#c9824a"];

function Final({ view, me, host, snapshot, client }: { view: RoomView; me: string; host: boolean; snapshot: Snapshot; client: ShapeClient }) {
  const game = view.game!;
  const table = standings(view.players);
  const winners = table.filter((r) => r.rank === 1);
  const hostName = view.players.find((p) => p.id === view.host)?.name ?? "the host";
  return (
    <Shell game={GAME} code={view.code}>
      <p className="text-[13px] text-muted">race over</p>
      <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
        {winners.length > 1 ? "it's a tie!" : winners[0] ? `${winners[0].player.id === me ? "you win" : `${winners[0].player.name} wins`}!` : "nobody raced"}
      </h1>
      <ol className="mt-5 space-y-1.5">
        {table.map(({ player, rank }) => (
          <li key={player.id} className="flex items-center gap-3 text-[15px]">
            <span className="w-10 font-mono text-[13px]" style={{ color: PODIUM[rank - 1] }}>
              {ordinal(rank)}
            </span>
            <Dot color={player.color} />
            <span className={`min-w-0 flex-1 truncate ${rank === 1 ? "font-semibold" : ""}`}>
              {player.name}
              {player.id === me && <span className="text-muted"> (you)</span>}
            </span>
            <span className="font-mono tabular-nums">{player.score}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {host ? (
          <>
            <Button tone="solid" onClick={() => void client.act("start")} disabled={snapshot.busy} className="min-h-10 px-5">
              race again
            </Button>
            <Button onClick={() => void client.act("lobby")} disabled={snapshot.busy} className="min-h-10">
              change settings
            </Button>
          </>
        ) : (
          <p className="text-muted">waiting for {hostName} to start another…</p>
        )}
        <span className="flex-1" />
        <Leave game={GAME} client={client} />
      </div>
      <ErrorLine snapshot={snapshot} client={client} />
      <section aria-labelledby="shapes" className="mt-10">
        <h2 id="shapes" className="text-muted">
          the shapes
        </h2>
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {game.past.map((code) => {
            const country = BY_CODE.get(code)!;
            return (
              <li key={code} className="rounded-lg bg-ink/[0.035] p-2 text-center text-[12px]">
                <Outline shape={country} className="mx-auto h-12 w-full text-ink" label={country.name} />
                <span className="mt-1 flex items-center justify-center gap-1 truncate">
                  <Flag code={code} className="h-2.5" />
                  {country.name}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </Shell>
  );
}
