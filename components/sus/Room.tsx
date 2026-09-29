"use client";

import { useState, type ReactNode } from "react";
import {
  IMPOSTOR_CHOICES,
  KILL_CHOICES,
  MEETINGS,
  MEETING_NAMES,
  MIN_PLAYERS,
  ROLES_MS,
  TASK_CHOICES,
  impostorsFor,
  type PlayerView,
  type Settings,
  type Why,
} from "@/lib/sus/room";
import type { SusView } from "@/lib/sus/server/rooms";
import { useServerNow } from "@/components/game/clock";
import { Connecting, ErrorLine, JoinForm, Leave, RoomGone, Shell, useAutoJoin, type GameName } from "@/components/game/room-ui";
import { Button, Choice, plural } from "@/components/game/ui";
import { Bean } from "./Bean";
import { Ejection, Meeting } from "./Meeting";
import { Play } from "./Play";
import { useSusRoom, type Snapshot, type SusClient } from "./room-client";

/** Set by the menu when you type a code with your name already in, so you go straight in. */
export const JOIN_FLAG = "sus:join";

export const GAME: GameName = { name: "sus", href: "/sus" };

export function Room({ code }: { code: string }) {
  const [snapshot, client] = useSusRoom(code);
  const { status, view, me, mine } = snapshot;
  useAutoJoin(JOIN_FLAG, code, snapshot, client);

  const gone = RoomGone({ game: GAME, code, status });
  if (gone) return gone;
  if (!view) return <Connecting game={GAME} code={code} />;

  const seated = me !== null && view.players.some((p) => p.id === me && p.active);
  if (!seated) {
    const note = view.game && view.game.phase !== "over" ? "a game is on; you'll be in the next one." : "";
    return <JoinForm game={GAME} code={code} players={view.players} note={note} snapshot={snapshot} client={client} />;
  }
  const game = view.game;
  if (!game) return <Lobby view={view} me={me!} snapshot={snapshot} client={client} />;
  if (game.phase === "over") return <Over view={view} me={me!} snapshot={snapshot} client={client} />;
  if (!mine || mine.game !== game.index) return <Watching view={view} me={me!} client={client} />;
  if (game.phase === "roles") return <Roles view={view} me={me!} snapshot={snapshot} />;
  if (game.phase === "meeting") return <Meeting view={view} me={me!} snapshot={snapshot} client={client} />;
  if (game.phase === "ejection") return <Ejection view={view} me={me!} />;
  return <Play view={view} me={me!} snapshot={snapshot} client={client} />;
}

/* ------------------------------------------------------------- helpers */

export const playersById = (view: SusView) => new Map(view.players.map((p) => [p.id, p]));

export const nameOf = (players: Map<string, PlayerView>, id: string | null, me?: string) => (id === me ? "you" : (players.get(id ?? "")?.name ?? "someone"));

/** A crewmate in their colour, with their name under. */
export function Crewmate({ player, me, dead = false, className = "size-12", note }: { player: PlayerView; me?: string; dead?: boolean; className?: string; note?: ReactNode }) {
  return (
    <span className="flex w-[4.5rem] flex-col items-center text-center">
      <Bean color={player.color} dead={dead} className={className} />
      <span className="mt-1 w-full truncate text-[12.5px] font-medium">{player.id === me ? "you" : player.name}</span>
      {note}
    </span>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  );
}

/* --------------------------------------------------------------- lobby */

function Lobby({ view, me, snapshot, client }: { view: SusView; me: string; snapshot: Snapshot; client: SusClient }) {
  const host = view.host === me;
  const players = view.players.filter((p) => p.active);
  const hostName = players.find((p) => p.id === view.host)?.name ?? "the host";
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const settings = view.settings;
  const change = (patch: Partial<Settings>) => void client.act("settings", { settings: { ...settings, ...patch } });
  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? view.code : `${window.location.origin}/sus/${view.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  };
  const enough = players.length >= MIN_PLAYERS;
  const impostors = impostorsFor(Math.max(players.length, MIN_PLAYERS), settings.impostors);
  const locked = !host || snapshot.busy;

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
        friends go to <span className="text-ink">{window.location.host}/sus</span> and type the code.
      </p>

      <section aria-labelledby="players" className="mt-10">
        <h2 id="players" className="text-muted">
          {plural(players.length, "player")} <span className="text-faint">· {MIN_PLAYERS} or more to play</span>
        </h2>
        <ul className="mt-3 flex flex-wrap gap-x-2 gap-y-3">
          {players.map((player) => (
            <li key={player.id} className="group relative">
              <Crewmate
                player={player}
                me={me}
                note={
                  <span className="text-[11px] text-muted">
                    {player.id === view.host ? "host" : player.away ? "away" : " "}
                    {host && player.id !== me && (
                      <button type="button" onClick={() => void client.act("kick", { target: player.id })} className="ml-1 text-muted hover:text-accent" aria-label={`remove ${player.name}`}>
                        ×
                      </button>
                    )}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="settings" className="mt-10">
        <h2 id="settings" className="text-muted">
          game {host ? "" : `· ${hostName} picks`}
        </h2>
        <div className="mt-3 space-y-4">
          <Row label="impostors" hint={`with ${plural(Math.max(players.length, MIN_PLAYERS), "player")}, that's ${impostors}: one up to six, two from seven, three from nine.`}>
            {IMPOSTOR_CHOICES.map((n) => (
              <Choice key={n} selected={settings.impostors === n} onSelect={() => change({ impostors: n })} disabled={locked}>
                up to {n}
              </Choice>
            ))}
          </Row>
          <Row label="between kills">
            {KILL_CHOICES.map((kill) => (
              <Choice key={kill} selected={settings.kill === kill} onSelect={() => change({ kill })} disabled={locked}>
                {kill}s
              </Choice>
            ))}
          </Row>
          <Row label="tasks each">
            {TASK_CHOICES.map((tasks) => (
              <Choice key={tasks} selected={settings.tasks === tasks} onSelect={() => change({ tasks })} disabled={locked}>
                {tasks}
              </Choice>
            ))}
          </Row>
          <Row label="meetings" hint={`${MEETINGS[settings.meeting].discuss}s to talk, then ${MEETINGS[settings.meeting].vote}s to vote.`}>
            {MEETING_NAMES.map((meeting) => (
              <Choice key={meeting} selected={settings.meeting === meeting} onSelect={() => change({ meeting })} disabled={locked}>
                {meeting}
              </Choice>
            ))}
          </Row>
          <Row label="when someone's voted off">
            <Choice selected={settings.confirm} onSelect={() => change({ confirm: true })} disabled={locked}>
              say what they were
            </Choice>
            <Choice selected={!settings.confirm} onSelect={() => change({ confirm: false })} disabled={locked}>
              keep it secret
            </Choice>
          </Row>
        </div>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        {host ? (
          <>
            <Button tone="solid" onClick={() => void client.act("start")} disabled={!enough || snapshot.busy} className="min-h-10 px-5">
              start the game
            </Button>
            {!enough && <span className="text-muted">you need at least {MIN_PLAYERS}: send people the code.</span>}
          </>
        ) : (
          <p className="text-muted">waiting for {hostName} to start…</p>
        )}
        <span className="flex-1" />
        <Leave game={GAME} client={client} />
      </div>
      <ErrorLine snapshot={snapshot} client={client} />

      <section aria-labelledby="how" className="mt-12 text-[13px] text-muted">
        <h2 id="how" className="text-ink">
          how to play
        </h2>
        <p className="mt-2">
          everyone&rsquo;s a crewmate, except the impostors, and only they know who they are. tap a room next to yours to go there; you can
          only see who&rsquo;s in the room with you. crewmates do their tasks (the yellow marks on the map). impostors pretend to, kill
          anyone they get alone, sneak through vents and sabotage the ship: the lights, so the crew can&rsquo;t see, or the reactor, which
          two people have to hold at once before it melts down. find a body, or press the button in the cafeteria, and everyone meets to
          talk it over and vote someone off. the crew win by finishing every task or voting off every impostor; the impostors win once
          there are as many of them as crew.
        </p>
      </section>
    </Shell>
  );
}

/* --------------------------------------------------------------- roles */

function Roles({ view, me, snapshot }: { view: SusView; me: string; snapshot: Snapshot }) {
  const game = view.game!;
  const mine = snapshot.mine!;
  const now = useServerNow(100);
  const players = playersById(view);
  const hush = now < game.ends - ROLES_MS + 1600;
  const team = mine.impostor ? [me, ...mine.mates] : view.players.filter((p) => p.playing).map((p) => p.id);
  return (
    <div className="fixed inset-0 grid place-items-center overflow-y-auto bg-[#07080b] p-6 text-white">
      {hush ? (
        <p key="hush" className="animate-pop text-[56px] font-black tracking-wide">
          shhhhh!
        </p>
      ) : (
        <div key="role" className="animate-fade-in text-center">
          <p className={`text-[48px] font-black tracking-wide sm:text-[64px] ${mine.impostor ? "text-[#ff3b3b]" : "text-[#8ce9ff]"}`}>{mine.impostor ? "impostor" : "crewmate"}</p>
          <p className="mt-1 text-[15px] text-white/80">
            {mine.impostor
              ? mine.mates.length
                ? `you and ${mine.mates.map((id) => players.get(id)?.name ?? "someone").join(" and ")}. kill the crew; don't get caught.`
                : "kill the crew. don't get caught."
              : `there ${game.impostors === 1 ? "is 1 impostor" : `are ${game.impostors} impostors`} among us.`}
          </p>
          <ul className="mx-auto mt-8 flex max-w-[40rem] flex-wrap justify-center gap-x-2 gap-y-4">
            {team.map((id) => {
              const player = players.get(id);
              return player && <li key={id}>{<Crewmate player={player} me={me} className="size-16" />}</li>;
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ watching */

/** For whoever arrived after the game started: what everyone knows, until the next. */
function Watching({ view, me, client }: { view: SusView; me: string; client: SusClient }) {
  const game = view.game!;
  const playing = view.players.filter((p) => p.playing);
  const doing = { roles: "finding out who they are", action: "about the ship", meeting: "in a meeting", ejection: "voting someone off" }[game.phase as "roles" | "action" | "meeting" | "ejection"];
  return (
    <Shell game={GAME} code={view.code}>
      <h1 className="text-[20px] font-semibold tracking-tight">a game&rsquo;s on</h1>
      <p className="mt-2 text-muted">
        {plural(playing.length, "player")} {doing ?? "playing"}. you&rsquo;ll be in the next one.
      </p>
      <TaskBar done={game.tasks.done} total={game.tasks.total} className="mt-6" />
      <ul className="mt-6 flex flex-wrap gap-x-2 gap-y-3">
        {playing.map((player) => (
          <li key={player.id} className={player.dead ? "opacity-50" : ""}>
            <Crewmate player={player} me={me} dead={player.dead} note={player.dead ? <span className="text-[11px] text-muted">{player.ejected ? "ejected" : "dead"}</span> : null} />
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <Leave game={GAME} client={client} />
      </div>
    </Shell>
  );
}

export function TaskBar({ done, total, className = "" }: { done: number; total: number; className?: string }) {
  const share = total ? done / total : 0;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`} role="progressbar" aria-label="the crew's tasks" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
      <span className="text-[12px] text-muted">tasks</span>
      <span className="h-3 min-w-16 flex-1 overflow-hidden rounded-full border border-ink/25 bg-ink/[0.06]">
        <span className="block h-full bg-[#40c057] transition-[width] duration-700" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="font-mono text-[12px] tabular-nums text-muted">{Math.round(share * 100)}%</span>
    </div>
  );
}

/* ---------------------------------------------------------------- over */

const WHY: Record<Why, string> = {
  tasks: "the crew finished every task",
  votes: "every impostor was voted off",
  outnumbered: "the impostors outnumbered the crew",
  reactor: "the reactor melted down",
  left: "the other side left",
};

function Over({ view, me, snapshot, client }: { view: SusView; me: string; snapshot: Snapshot; client: SusClient }) {
  const game = view.game!;
  const result = game.result!;
  const host = view.host === me;
  const impostors = new Set(result.impostors);
  const playing = view.players.filter((p) => p.playing);
  const mine = playing.some((p) => p.id === me) ? (impostors.has(me) ? "impostors" : "crew") : null;
  const won = mine === result.winner;
  const winners = playing.filter((p) => (result.winner === "impostors") === impostors.has(p.id));
  const hostName = view.players.find((p) => p.id === view.host)?.name ?? "the host";
  const enough = view.players.filter((p) => p.active).length >= MIN_PLAYERS;
  return (
    <div className="min-h-dvh bg-[#07080b] text-white">
      <div className="mx-auto w-full max-w-[44rem] px-6 py-12 text-center sm:py-16">
        <p className={`animate-pop text-[52px] font-black tracking-wide sm:text-[68px] ${mine === null ? "text-white" : won ? "text-[#8ce9ff]" : "text-[#ff3b3b]"}`}>
          {mine === null ? `${result.winner === "crew" ? "crewmates" : "impostors"} win` : won ? "victory" : "defeat"}
        </p>
        <p className="mt-1 text-white/75">{WHY[result.why]}.</p>
        <ul className="mt-8 flex flex-wrap justify-center gap-x-3 gap-y-4">
          {winners.map((player) => (
            <li key={player.id}>
              <Crewmate player={player} me={me} className="size-16" />
            </li>
          ))}
        </ul>
        <section aria-labelledby="who" className="mx-auto mt-10 max-w-[30rem] text-left">
          <h2 id="who" className="text-[13px] text-white/60">
            who was who
          </h2>
          <ul className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {playing.map((player) => (
              <li key={player.id} className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-2 py-1.5">
                <Bean color={player.color} dead={player.dead && !player.ejected} className="size-7 shrink-0" />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[13px] font-medium">{player.id === me ? "you" : player.name}</span>
                  <span className={`block text-[11.5px] ${impostors.has(player.id) ? "text-[#ff6b6b]" : "text-white/55"}`}>
                    {impostors.has(player.id) ? "impostor" : "crewmate"}
                    {player.ejected ? " · ejected" : player.dead ? " · dead" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {host ? (
            <>
              <button
                type="button"
                disabled={!enough || snapshot.busy}
                onClick={() => void client.act("start")}
                className="min-h-10 rounded-lg bg-white px-5 text-[14px] font-semibold text-neutral-900 hover:bg-white/90 disabled:opacity-60"
              >
                play again
              </button>
              <button
                type="button"
                disabled={snapshot.busy}
                onClick={() => void client.act("lobby")}
                className="min-h-10 rounded-lg border border-white/50 px-5 text-[14px] font-medium hover:bg-white/10 disabled:opacity-60"
              >
                change settings
              </button>
            </>
          ) : (
            <p className="text-[13px] text-white/70">waiting for {hostName} to start another…</p>
          )}
        </div>
        {host && !enough && <p className="mt-2 text-[12.5px] text-white/60">you need at least {MIN_PLAYERS} players for another game.</p>}
        <div className="mt-6 [&_*]:!text-white/70">
          <Leave game={GAME} client={client} />
        </div>
        <ErrorLine snapshot={snapshot} client={client} />
      </div>
    </div>
  );
}
