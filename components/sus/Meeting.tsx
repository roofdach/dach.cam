"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { unseal } from "@/lib/draw/secret";
import { EJECT_MS, type PlayerView } from "@/lib/sus/room";
import type { ChatLine, Mine, SusView } from "@/lib/sus/server/rooms";
import { ROOMS } from "@/lib/sus/ship";
import { useServerNow } from "@/components/game/clock";
import { ErrorLine } from "@/components/game/room-ui";
import { Bean } from "./Bean";
import { nameOf, playersById } from "./Room";
import type { Snapshot, SusClient } from "./room-client";

const until = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / 1000));

/* ------------------------------------------------------------- meeting */

export function Meeting({ view, me, snapshot, client }: { view: SusView; me: string; snapshot: Snapshot; client: SusClient }) {
  const game = view.game!;
  const meeting = game.meeting!;
  const mine = snapshot.mine!;
  const players = playersById(view);
  const now = useServerNow(250);
  const open = now >= meeting.votesFrom;
  const [pick, setPick] = useState<string | null>(null);
  const table = view.players.filter((p) => p.playing);
  const voted = new Set(meeting.voted);
  const canVote = mine.alive && mine.vote === null && open;
  const caller = nameOf(players, meeting.caller, me);

  const cast = async () => {
    if (!pick) return;
    await client.vote(pick);
    setPick(null);
  };

  return (
    <div className="min-h-dvh bg-[#1b2230] text-white">
      <div className="mx-auto grid w-full max-w-[64rem] gap-4 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="animate-pop text-[26px] font-black tracking-tight sm:text-[32px]">{meeting.body ? "dead body reported" : "emergency meeting"}</h1>
              <p className="text-[14px] text-white/75">
                {meeting.body
                  ? `${caller} found ${nameOf(players, meeting.body, me)}${meeting.body === me ? "r" : "'s"} body in ${ROOMS[meeting.where!].name}.`
                  : `${caller} pressed the button.`}{" "}
                who is the impostor?
              </p>
            </div>
            <p className="font-mono text-[15px] tabular-nums text-white/80" aria-live="polite">
              {open ? `voting ends in ${until(meeting.ends, now)}s` : `voting opens in ${until(meeting.votesFrom, now)}s`}
            </p>
          </div>

          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {table.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  disabled={!canVote || player.dead}
                  onClick={() => setPick(player.id)}
                  className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors ${player.dead ? "bg-white/[0.03]" : "bg-white/[0.08] enabled:hover:bg-white/[0.15]"} ${pick === player.id ? "ring-2 ring-white" : ""}`}
                >
                  <span className="relative shrink-0">
                    <Bean color={player.color} className={`size-11 ${player.dead ? "opacity-40" : ""}`} />
                    {player.dead && (
                      <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto size-9" aria-hidden>
                        <path d="M5 5l14 14M19 5L5 19" stroke="#ff3b3b" strokeWidth={3.5} strokeLinecap="round" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className={`block truncate text-[15px] font-semibold ${player.dead ? "text-white/45 line-through" : ""}`}>{player.id === me ? `${player.name} (you)` : player.name}</span>
                    <span className="block text-[12px] text-white/55">
                      {player.dead ? (player.ejected ? "ejected" : player.active ? "dead" : "left") : meeting.caller === player.id ? "called the meeting" : player.away ? "away" : ""}
                    </span>
                  </span>
                  {voted.has(player.id) && <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10.5px] font-bold text-[#1b2230]">voted</span>}
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {pick ? (
              <>
                <span className="text-[14px]">{pick === "skip" ? "skip your vote?" : `vote for ${nameOf(players, pick, me)}?`}</span>
                <button type="button" onClick={() => void cast()} disabled={snapshot.busy} className="min-h-9 rounded-lg bg-[#40c057] px-4 text-[14px] font-bold text-[#0b1f10] hover:bg-[#51cf66] disabled:opacity-60">
                  yes
                </button>
                <button type="button" onClick={() => setPick(null)} className="min-h-9 rounded-lg border border-white/40 px-4 text-[14px] hover:bg-white/10">
                  no
                </button>
              </>
            ) : canVote ? (
              <button type="button" onClick={() => setPick("skip")} className="min-h-9 rounded-lg border border-white/40 px-4 text-[14px] hover:bg-white/10">
                skip vote
              </button>
            ) : (
              <p className="text-[14px] text-white/70">
                {!mine.alive
                  ? "you're dead: no vote, but the other ghosts can hear you."
                  : mine.vote
                    ? mine.vote === "skip"
                      ? "you skipped."
                      : `you voted for ${nameOf(players, mine.vote, me)}.`
                    : "talk it over first: voting opens soon."}
              </p>
            )}
          </div>
          <ErrorLine snapshot={snapshot} client={client} />

          {mine.seen.length > 0 && (
            <section aria-labelledby="saw" className="mt-5 rounded-xl bg-[#e03131]/15 p-3">
              <h2 id="saw" className="text-[13px] font-semibold text-[#ff8787]">
                what you saw
              </h2>
              <ul className="mt-1 space-y-0.5 text-[14px]">
                {mine.seen.map((note) => (
                  <li key={`${note.t}:${note.kind}:${note.who}`}>
                    {note.kind === "kill"
                      ? `${nameOf(players, note.who, me)} killed ${nameOf(players, note.whom, me)} in ${ROOMS[note.room].name}`
                      : `${nameOf(players, note.who, me)} used a vent in ${ROOMS[note.room].name}`}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!mine.alive && mine.killer && <p className="mt-4 text-[13px] text-white/70">{nameOf(players, mine.killer, me)} killed you. only other ghosts can read what you say.</p>}
        </section>

        <Chat view={view} me={me} mine={mine} players={players} client={client} />
      </div>
    </div>
  );
}

const SEND_GAP_MS = 350;
const lineId = (c: ChatLine) => `${c.t}:${c.p}:${c.iv ?? ""}`;

function Chat({ view, me, mine, players, client }: { view: SusView; me: string; mine: Mine; players: Map<string, PlayerView>; client: SusClient }) {
  const game = view.game!;
  const meeting = game.meeting!;
  const lines = useMemo(() => view.chat.filter((c) => c.g === game.index && c.m === meeting.index), [view.chat, game.index, meeting.index]);
  const key = mine.ghostKey;
  const [opened, setOpened] = useState<Record<string, string>>({});
  const list = useRef<HTMLDivElement>(null);
  const lastSent = useRef(0);
  const [text, setText] = useState("");

  // The dead's lines, opened with their key once you're one of them.
  useEffect(() => {
    const pending = key ? lines.filter((c) => c.iv && !(lineId(c) in opened)) : [];
    if (!key || pending.length === 0) return;
    let live = true;
    void Promise.all(pending.map(async (c) => [lineId(c), await unseal(key, c.iv!, c.text)] as const)).then((pairs) => {
      if (!live) return;
      setOpened((current) => {
        const next = { ...current };
        for (const [id, plain] of pairs) next[id] = plain ?? "";
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [lines, key, opened]);

  const shown = lines.filter((c) => !c.iv || opened[lineId(c)]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [shown.length]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    const wait = Math.max(0, lastSent.current + SEND_GAP_MS - Date.now());
    lastSent.current = Date.now() + wait;
    setTimeout(() => void client.say(message), wait);
  };

  return (
    <section aria-label="chat" className="flex h-[22rem] min-h-0 flex-col overflow-hidden rounded-xl bg-black/25 lg:h-[calc(100dvh-2.5rem)]">
      <div ref={list} role="log" aria-live="polite" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3 text-[13.5px] leading-snug">
        {shown.length === 0 && <p className="text-white/50">{mine.alive ? "say what you saw, and where you were." : "only the dead can hear you now."}</p>}
        {shown.map((c) => {
          const ghost = !!c.iv;
          const color = players.get(c.p)?.color ?? 0;
          return (
            <p key={lineId(c)} className={`flex gap-2 break-words ${ghost ? "text-white/60 italic" : ""}`}>
              <Bean color={color} ghost={ghost} className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="font-semibold not-italic">{c.p === me ? "you" : c.n}</span>
                {ghost && <span className="text-white/40"> (ghost)</span>}: {ghost ? opened[lineId(c)] : c.text}
              </span>
            </p>
          );
        })}
      </div>
      <form onSubmit={submit} className="flex items-center gap-1 border-t border-white/10 p-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={120}
          autoComplete="off"
          enterKeyHint="send"
          aria-label="your message"
          placeholder={mine.alive ? "say something…" : "only the dead can hear you"}
          className="min-h-10 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[16px] text-white outline-none placeholder:text-white/40 focus:bg-white/[0.06] sm:text-[14px]"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          onPointerDown={(e) => e.preventDefault()}
          className="min-h-10 rounded-md px-3 text-[13.5px] font-semibold text-white hover:bg-white/10 disabled:text-white/30"
        >
          send
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------ ejection */

function Drifter({ color }: { color: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = ref.current?.animate(
      [
        { transform: "translateX(-20vw) rotate(0deg)" },
        { transform: "translateX(120vw) rotate(900deg)" },
      ],
      { duration: 5200, easing: "linear", fill: "forwards" },
    );
    return () => animation?.cancel();
  }, []);
  return (
    <div ref={ref} className="absolute left-0 top-[28%] size-20" style={{ transform: "translateX(-20vw)" }}>
      <Bean color={color} className="size-20" />
    </div>
  );
}

export function Ejection({ view, me }: { view: SusView; me: string }) {
  const game = view.game!;
  const ejection = game.ejection!;
  const players = playersById(view);
  const now = useServerNow(60);
  const since = now - (game.ends - EJECT_MS);
  const out = ejection.ejected ? players.get(ejection.ejected) : undefined;
  const who = out?.id === me ? "you" : out?.name;
  const was = out?.id === me ? "were" : "was";
  const first = out
    ? ejection.impostor === null
      ? `${who} ${was} ejected.`
      : `${who} ${was} ${ejection.impostor ? "" : "not "}${game.impostors === 1 ? "the" : "an"} impostor.`
    : `no one was ejected. (${ejection.tie ? "tie" : "skipped"})`;
  const second = out && ejection.remaining !== null ? `${ejection.remaining} impostor${ejection.remaining === 1 ? " remains" : "s remain"}.` : "";
  const typed = Math.max(0, Math.floor((since - 1000) / 55));
  const tally = new Map<string, string[]>();
  for (const [voter, choice] of Object.entries(ejection.votes)) tally.set(choice, [...(tally.get(choice) ?? []), voter]);
  const rows = [...tally].sort((a, b) => b[1].length - a[1].length);

  return (
    <div
      className="relative min-h-dvh overflow-hidden bg-[#05060a] text-white"
      style={{ backgroundImage: "radial-gradient(#ffffff55 1px, transparent 1.5px), radial-gradient(#ffffff30 1px, transparent 1.5px)", backgroundSize: "90px 90px, 53px 53px", backgroundPosition: "0 0, 27px 41px" }}
    >
      {out && <Drifter color={out.color} />}
      <div className="relative mx-auto flex min-h-dvh max-w-[40rem] flex-col items-center justify-center px-6 text-center">
        <p className="min-h-[2.5em] text-[22px] font-semibold sm:text-[28px]" aria-live="polite" aria-label={`${first} ${second}`}>
          <span aria-hidden>{first.slice(0, typed)}</span>
        </p>
        <p className="min-h-[1.5em] text-[16px] text-white/75" aria-hidden>
          {second.slice(0, Math.max(0, typed - first.length - 6))}
        </p>
        {since > 3200 && rows.length > 0 && (
          <ul className="mt-8 w-full max-w-[24rem] animate-fade-in space-y-1.5 text-left text-[13px]">
            {rows.map(([choice, voters]) => (
              <li key={choice} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-white/70">{choice === "skip" ? "skipped" : nameOf(players, choice, me)}</span>
                <span className="flex flex-wrap gap-1">
                  {voters.map((v) => (
                    <Bean key={v} color={players.get(v)?.color ?? 0} className="size-5" label={nameOf(players, v, me)} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
