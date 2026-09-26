"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Op } from "@/lib/draw/ink";
import { MIN_PLAYERS, SPEEDS, SPEED_NAMES, type Entry, type PlayerView } from "@/lib/phone/room";
import { useServerNow } from "@/components/game/clock";
import { Connecting, Crumbs, ErrorLine, JoinForm, Leave, RoomGone, Shell, useAutoJoin, type GameName } from "@/components/game/room-ui";
import { KEYS } from "@/components/game/storage";
import { Button, Choice, Spinner, plural } from "@/components/game/ui";
import { usePhoneRoom, showing, type PhoneClient, type Snapshot, type View } from "./room-client";
import { DrawTask, FittedPicture, Picture, TextTask, forgetOldDrafts } from "./Work";

/** Set by the menu when you type a code with your name already in, so you go straight in. */
export const JOIN_FLAG = "phone:join";

const GAME: GameName = { name: "phone", href: "/phone" };

export function Room({ code }: { code: string }) {
  const [snapshot, client] = usePhoneRoom(code);
  const { status, view, me } = snapshot;
  useAutoJoin(JOIN_FLAG, code, snapshot, client);

  const gone = RoomGone({ game: GAME, code, status });
  if (gone) return gone;
  if (!view) return <Connecting game={GAME} code={code} />;

  const seated = me !== null && view.players.some((p) => p.id === me && p.active);
  if (!seated) {
    const note = view.game?.phase === "playing" ? "a game is on; you'll watch the end of it and play in the next one." : "";
    return <JoinForm game={GAME} code={code} players={view.players} note={note} snapshot={snapshot} client={client} />;
  }
  if (!view.game) return <Lobby view={view} me={me!} snapshot={snapshot} client={client} />;
  if (view.game.phase === "playing") return <Play view={view} me={me!} snapshot={snapshot} client={client} />;
  return <Reveal view={view} me={me!} snapshot={snapshot} client={client} />;
}

/* --------------------------------------------------------------- lobby */

const SPEED_BLURBS: Record<string, string> = {
  quick: `${SPEEDS.quick.draw}s to draw`,
  normal: `${SPEEDS.normal.draw}s to draw`,
  slow: `${SPEEDS.slow.draw}s to draw`,
};

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

function Lobby({ view, me, snapshot, client }: { view: View; me: string; snapshot: Snapshot; client: PhoneClient }) {
  const host = view.host === me;
  const players = view.players.filter((p) => p.active);
  const hostName = players.find((p) => p.id === view.host)?.name ?? "the host";
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const enough = players.length >= MIN_PLAYERS;

  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? view.code : `${window.location.origin}/phone/${view.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  };

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
        friends go to <span className="text-ink">{window.location.host}/phone</span> and type the code.
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
          game {host ? "" : `· ${hostName} picks`}
        </h2>
        <div role="group" aria-label="speed" className="mt-3 flex flex-col gap-1.5">
          <span className="text-[12.5px] text-muted">speed</span>
          <div className="flex flex-wrap gap-1.5">
            {SPEED_NAMES.map((speed) => (
              <Choice key={speed} selected={view.settings.speed === speed} onSelect={() => void client.act("settings", { settings: { speed } })} disabled={!host || snapshot.busy} title={SPEED_BLURBS[speed]}>
                {speed}
              </Choice>
            ))}
          </div>
          <span className="text-[12.5px] text-muted">
            {SPEEDS[view.settings.speed].write}s to write, {SPEEDS[view.settings.speed].draw}s to draw, {SPEEDS[view.settings.speed].describe}s to describe.
          </span>
        </div>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        {host ? (
          <>
            <Button tone="solid" onClick={() => void client.act("start")} disabled={!enough || snapshot.busy} className="min-h-10 px-5">
              start the game
            </Button>
            <span className="text-muted">{enough ? (players.length < 4 ? "best with four or more." : "") : "you need at least two players: send someone the code."}</span>
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
          everyone writes something to draw. then it goes round: you draw what the person before you wrote, and the next person writes
          what they think your drawing is, and the next draws that, until every chain has been all the way round. at the end the
          chains are shown one step at a time, so everyone sees how &ldquo;a dog on a skateboard&rdquo; turned into something else
          entirely.
        </p>
      </section>
    </Shell>
  );
}

/* ---------------------------------------------------------------- play */

function Timer({ ends }: { ends: number }) {
  const now = useServerNow(250);
  const seconds = Math.max(0, Math.ceil((ends - now) / 1000));
  return (
    <span aria-label={`${seconds} seconds left`} className={`min-w-[3ch] text-right font-mono text-[20px] font-semibold tabular-nums ${seconds <= 10 ? "text-accent" : ""}`}>
      {seconds}
    </span>
  );
}

const TITLES = { write: "write something to draw", draw: "draw it", describe: "say what it is" } as const;

const IDEAS = [
  "a penguin at a job interview",
  "grandma winning a rap battle",
  "a cat stuck in a bin",
  "the moon eating spaghetti",
  "a shark who is scared of water",
  "a snowman on holiday",
];

function Play({ view, me, snapshot, client }: { view: View; me: string; snapshot: Snapshot; client: PhoneClient }) {
  const game = view.game!;
  const playing = game.order.includes(me);
  const mine = snapshot.mine && snapshot.mine.game === game.index && snapshot.mine.step === game.step ? snapshot.mine : null;
  const task = mine?.task ?? null;
  const handed = game.handed.includes(me) || !!mine?.handed;
  const draft = KEYS.phoneDraft(view.code, game.index, game.step);
  const [idea] = useState(() => IDEAS[Math.floor(Math.random() * IDEAS.length)]);

  useEffect(() => forgetOldDrafts(view.code, draft), [view.code, draft]);

  const handIn = (work: { text: string } | { ops: Op[] }) => client.submit(game.index, game.step, work);
  const prompt = mine?.prompt ?? null;

  let body: ReactNode;
  if (!playing) {
    body = <Waiting view={view} title="a game's on" note="you'll play in the next one. the chains get shown to everyone at the end." />;
  } else if (handed) {
    body = <Waiting view={view} title="handed in" note="waiting for everyone else…" />;
  } else if (!task) {
    body = (
      <p className="m-auto text-muted">
        <Spinner className="mr-2" /> getting your next step…
      </p>
    );
  } else if (task.kind === "write") {
    body = (
      <Centered>
        <TextTask key={draft} draft={draft} ends={game.ends} busy={snapshot.busy} onHandIn={(text) => handIn({ text })} label="write something for the next person to draw" placeholder={idea} />
      </Centered>
    );
  } else if (task.kind === "draw") {
    body = (
      <>
        <p className="mb-2 text-center text-[13px] text-muted">
          draw this: <span className="block text-[20px] font-semibold leading-snug text-ink">{prompt && "text" in prompt ? prompt.text : "…"}</span>
        </p>
        {prompt ? <DrawTask key={draft} draft={draft} ends={game.ends} busy={snapshot.busy} onHandIn={(ops) => handIn({ ops })} /> : <Spinner className="m-auto" />}
      </>
    );
  } else {
    body =
      prompt && "ops" in prompt ? (
        <TextTask key={draft} draft={draft} ends={game.ends} busy={snapshot.busy} onHandIn={(text) => handIn({ text })} label="what is this a drawing of?" placeholder="a…">
          <FittedPicture ops={prompt.ops} />
        </TextTask>
      ) : (
        <Spinner className="m-auto" />
      );
  }

  return (
    <div className="flex min-h-dvh flex-col text-[14px] lg:h-dvh lg:min-h-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-faint/50 px-3 py-2 sm:gap-x-4 sm:px-4">
        <Crumbs game={GAME} code={view.code} compact />
        <span className="text-[13px] text-muted">
          step {game.step + 1} of {game.steps}
        </span>
        <span className="order-last basis-full text-center font-medium sm:order-none sm:flex-1 sm:basis-auto">{playing && task && !handed ? TITLES[task.kind] : ""}</span>
        <span className="flex-1 sm:hidden" />
        <Timer ends={game.ends} />
        <Leave game={GAME} client={client} label="leave" />
      </header>
      <main className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        {body}
        <ErrorLine snapshot={snapshot} client={client} />
      </main>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="m-auto flex w-full max-w-[40rem] flex-col">{children}</div>;
}

function Waiting({ view, title, note }: { view: View; title: string; note: string }) {
  const game = view.game!;
  const done = new Set(game.handed);
  const names = new Map(view.players.map((p) => [p.id, p]));
  const waiting = game.order.filter((id) => names.get(id)?.active);
  return (
    <div className="m-auto w-full max-w-[28rem] text-center">
      <p className="text-[18px] font-semibold">{title}</p>
      <p className="mt-1 text-muted">{note}</p>
      <p className="mt-4 text-[13px] text-muted">
        {done.size} of {waiting.length} done
      </p>
      <ul className="mt-2 flex flex-wrap justify-center gap-1.5">
        {waiting.map((id) => {
          const player = names.get(id)!;
          return (
            <li key={id} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] ${done.has(id) ? "bg-[#d3f9d8] text-[#2b8a3e] dark:bg-[#1f3d25] dark:text-[#8ce99a]" : "bg-ink/[0.05] text-muted"}`}>
              <Dot color={player.color} />
              {player.name}
              {done.has(id) && <span aria-label="done">✓</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------- reveal */

function Reveal({ view, me, snapshot, client }: { view: View; me: string; snapshot: Snapshot; client: PhoneClient }) {
  const game = view.game!;
  const album = game.album!;
  const host = view.host === me;
  const hostName = view.players.find((p) => p.id === view.host)?.name ?? "the host";
  const names = useMemo(() => new Map<string, PlayerView>(view.players.map((p) => [p.id, p])), [view.players]);
  const total = album.reduce((n, c) => n + c.entries.length, 0);
  const { chain, count } = showing(album, game.shown);
  const current = album[chain];
  const work = snapshot.chains[`${game.index}.${chain}`];
  const byStep = useMemo(() => new Map<number, Entry>((work ?? []).map((e) => [e.step, e])), [work]);
  const done = game.shown >= total;
  const chainsWithWork = album.filter((c) => c.entries.length > 0);
  const chainNumber = chainsWithWork.indexOf(current) + 1;
  // What was already showing when you arrived appears at once; what's shown after that is drawn out.
  const [arrived] = useState(game.shown);
  const before = album.slice(0, chain).reduce((n, c) => n + c.entries.length, 0);
  const last = useRef<HTMLLIElement>(null);

  useEffect(() => {
    last.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count, chain, work]);

  const next = () => void client.showNext();
  // The host can click through with the arrow key or space, too.
  useEffect(() => {
    if (!host || done) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "ArrowRight" || event.key === " ") && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        void client.showNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [host, done, client]);

  const lastOfChain = count >= current.entries.length;

  return (
    <div className="min-h-dvh text-[14px]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-faint/50 bg-paper/95 px-3 py-2 backdrop-blur sm:px-4">
        <Crumbs game={GAME} code={view.code} compact />
        <span className="text-[13px] text-muted">{total === 0 ? "nothing to show" : `chain ${chainNumber} of ${chainsWithWork.length}`}</span>
        <span className="flex-1" />
        <Leave game={GAME} client={client} label="leave" />
      </header>

      <main className="mx-auto w-full max-w-[36rem] px-4 pb-40 pt-8">
        {total === 0 ? (
          <p className="text-center text-muted">nobody handed anything in this time.</p>
        ) : (
          <>
            <h1 className="text-center text-[22px] font-semibold tracking-tight">{names.get(current.owner)?.name ?? "someone"}&rsquo;s chain</h1>
            <ol className="mt-6 space-y-6">
              {current.entries.slice(0, count).map((entry, i) => {
                const content = byStep.get(entry.step);
                const who = names.get(entry.p);
                const newest = i === count - 1;
                return (
                  <li key={`${game.index}.${chain}.${entry.step}`} ref={newest ? last : undefined} className="animate-fade-in">
                    <p className="mb-1.5 flex items-center gap-2 text-[13px] text-muted">
                      <Dot color={who?.color ?? "#999"} />
                      <span className="font-medium text-ink">{who?.name ?? "someone"}</span>
                      {entry.work === "drawing" ? "drew" : i === 0 ? "wrote" : "thought it was"}
                    </p>
                    {!content ? (
                      <Spinner />
                    ) : "text" in content ? (
                      <p className="rounded-2xl bg-ink/[0.05] px-4 py-3 text-[18px] leading-snug">{content.text}</p>
                    ) : (
                      <Picture ops={content.ops} animate={before + i + 1 > arrived} label={`${who?.name ?? "someone"}'s drawing`} />
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {done && total > 0 && <p className="mt-10 text-center text-[16px] font-semibold">that&rsquo;s every chain!</p>}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-faint/50 bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[36rem] flex-wrap items-center justify-center gap-2">
          {host ? (
            done ? (
              <>
                <Button tone="solid" onClick={() => void client.act("start")} disabled={snapshot.busy || view.players.filter((p) => p.active).length < MIN_PLAYERS} className="min-h-10 px-5">
                  play again
                </Button>
                <Button onClick={() => void client.act("lobby")} disabled={snapshot.busy} className="min-h-10">
                  change settings
                </Button>
              </>
            ) : (
              <Button tone="solid" onClick={next} disabled={snapshot.busy} className="min-h-10 px-6">
                {lastOfChain ? "next chain" : "next"}
              </Button>
            )
          ) : (
            <p className="text-muted">{done ? `waiting for ${hostName} to start another…` : `${hostName} is showing the chains…`}</p>
          )}
        </div>
        <div className="mx-auto max-w-[36rem]">
          <ErrorLine snapshot={snapshot} client={client} />
        </div>
      </footer>
    </div>
  );
}
