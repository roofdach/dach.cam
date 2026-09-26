"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MAX_CUSTOM_WORDS, MIN_PLAYERS, ROUND_CHOICES, TIME_CHOICES, type NoteView, type PlayerView, type Settings, type TurnView } from "@/lib/draw/room";
import { useServerNow } from "@/components/game/clock";
import { Connecting, Crumbs, ErrorLine, JoinForm, Leave, RoomGone, Shell, useAutoJoin, type GameName } from "@/components/game/room-ui";
import { Button, Choice, Spinner, ordinal, plural } from "@/components/game/ui";
import { Board } from "./Board";
import { useDrawRoom, type DrawClient, type LocalLine, type Snapshot, type View } from "./room-client";

/** Set by the menu when you type a code with your name already in, so you go straight in. */
export const JOIN_FLAG = "draw:join";

const GAME: GameName = { name: "draw", href: "/draw" };

export function Room({ code }: { code: string }) {
  const [snapshot, client] = useDrawRoom(code);
  const { status, view, me } = snapshot;
  useAutoJoin(JOIN_FLAG, code, snapshot, client);

  const gone = RoomGone({ game: GAME, code, status });
  if (gone) return gone;
  if (!view) return <Connecting game={GAME} code={code} />;

  const seated = me !== null && view.players.some((p) => p.id === me && p.active);
  if (!seated) {
    const note = view.game && view.game.phase !== "final" ? "a game is on; you'll join in and get a turn to draw." : "";
    return <JoinForm game={GAME} code={code} players={view.players} note={note} snapshot={snapshot} client={client} />;
  }
  if (!view.game) return <Lobby view={view} me={me!} snapshot={snapshot} client={client} />;
  return <Game view={view} me={me!} snapshot={snapshot} client={client} />;
}

/* --------------------------------------------------------------- lobby */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

/** Words typed with commas or on lines of their own. */
const splitWords = (text: string) =>
  text
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);

function Lobby({ view, me, snapshot, client }: { view: View; me: string; snapshot: Snapshot; client: DrawClient }) {
  const host = view.host === me;
  const players = view.players.filter((p) => p.active);
  const hostName = players.find((p) => p.id === view.host)?.name ?? "the host";
  // The host's own words come separately, since they're a secret from everyone else.
  const words = host ? (snapshot.mine?.words ?? null) : null;
  const [pending, setPending] = useState<Settings | null>(null);
  const settings: Settings = pending ?? { rounds: view.settings.rounds, time: view.settings.time, words: words ?? [], only: view.settings.only };
  const editable = host && words !== null;
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const change = async (patch: Partial<Settings>) => {
    if (!editable) return;
    const next = { ...settings, ...patch };
    setPending(next);
    await client.act("settings", { settings: next });
    setPending((current) => (current === next ? null : current));
  };

  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? view.code : `${window.location.origin}/draw/${view.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  };

  const enough = players.length >= MIN_PLAYERS;

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
        friends go to <span className="text-ink">{window.location.host}/draw</span> and type the code.
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
        <div className="mt-3 space-y-4">
          <Row label="rounds">
            {ROUND_CHOICES.map((rounds) => (
              <Choice key={rounds} selected={settings.rounds === rounds} onSelect={() => void change({ rounds })} disabled={!editable}>
                {rounds}
              </Choice>
            ))}
          </Row>
          <Row label="time to draw">
            {TIME_CHOICES.map((time) => (
              <Choice key={time} selected={settings.time === time} onSelect={() => void change({ time })} disabled={!editable}>
                {time}s
              </Choice>
            ))}
          </Row>
          {host ? (
            <WordsEditor words={settings.words} only={settings.only} disabled={!editable} onChange={(patch) => void change(patch)} />
          ) : (
            view.settings.words > 0 && (
              <p className="text-[13px] text-muted">
                with {plural(view.settings.words, "word")} of {hostName}&rsquo;s own{view.settings.only ? ", and only those" : " in the mix"}.
              </p>
            )
          )}
        </div>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        {host ? (
          <>
            <Button tone="solid" onClick={() => void client.act("start")} disabled={!enough || snapshot.busy || pending !== null} className="min-h-10 px-5">
              start the game
            </Button>
            {!enough && <span className="text-muted">you need at least {MIN_PLAYERS} players: send someone the code.</span>}
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
          everyone takes turns to draw. the drawer picks one of three words and draws it; everyone else types guesses in the chat. the
          sooner you guess, the more you score, and the drawer scores for everyone who gets it. letters show up as hints as time runs
          out. no writing the word on the board!
        </p>
      </section>
    </Shell>
  );
}

function WordsEditor({
  words,
  only,
  disabled,
  onChange,
}: {
  words: string[];
  only: boolean;
  disabled: boolean;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? words.join(", ");
  const typed = splitWords(shown);
  const save = () => {
    if (text === null) return;
    const list = splitWords(text).slice(0, MAX_CUSTOM_WORDS);
    setText(null);
    if (list.join("\n") !== words.join("\n")) onChange({ words: list, only: only && list.length >= 3 });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="words" className="text-[12.5px] text-muted">
        your own words <span className="text-faint">(optional; commas between them)</span>
      </label>
      <textarea
        id="words"
        value={shown}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        disabled={disabled}
        rows={3}
        maxLength={8000}
        placeholder="our teacher, the school bus, pizza friday"
        className="rounded-lg border border-faint bg-paper px-3 py-2 text-[14px] leading-snug outline-none placeholder:text-faint focus:border-ink disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
        <span>
          {plural(typed.length, "word")}
          {typed.length > MAX_CUSTOM_WORDS && `; only the first ${MAX_CUSTOM_WORDS} count`}
        </span>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={only}
            disabled={disabled || words.length < 3 || text !== null}
            onChange={(e) => onChange({ only: e.target.checked })}
            className="accent-[var(--ink)]"
          />
          only use these {words.length < 3 && "(needs 3 or more)"}
        </label>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- game */

interface Standing {
  player: PlayerView;
  rank: number;
}

function standings(players: PlayerView[]): Standing[] {
  const rows = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // Equal scores share a place.
  return rows.map((player) => ({ player, rank: rows.findIndex((r) => r.score === player.score) + 1 }));
}

function Game({ view, me, snapshot, client }: { view: View; me: string; snapshot: Snapshot; client: DrawClient }) {
  const game = view.game!;
  const turn = game.turn;
  const host = view.host === me;
  const myTurn = turn?.drawer === me;
  const known = turn && snapshot.mine?.turn === turn.id ? snapshot.mine : null;
  const word = known?.word ?? null;
  const drawing = myTurn && turn?.phase === "drawing" && word !== null;
  const guessing = !!turn && turn.phase === "drawing" && !myTurn && !turn.guessed.includes(me);
  const drawerName = view.players.find((p) => p.id === turn?.drawer)?.name ?? "someone";

  return (
    <div className="flex min-h-dvh flex-col text-[14px] lg:h-dvh lg:min-h-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-faint/50 px-3 py-2 sm:gap-x-4 sm:px-4">
        <Crumbs game={GAME} code={view.code} compact />
        <span className="text-[13px] text-muted">
          {game.phase === "final" ? "game over" : `round ${turn?.round ?? game.round} of ${game.rounds}`}
        </span>
        <div className="order-last flex min-w-0 basis-full justify-center sm:order-none sm:basis-auto sm:flex-1">
          <WordLine turn={turn} myTurn={myTurn} word={word} drawerName={drawerName} guessed={!!turn && turn.guessed.includes(me)} />
        </div>
        <span className="flex-1 sm:hidden" />
        {turn && <Timer ends={turn.ends} urgent={turn.phase === "drawing"} />}
        <div className="flex items-center gap-1">
          {host && game.phase !== "final" && <EndGame client={client} />}
          <Leave game={GAME} client={client} label="leave" />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[12.5rem_minmax(0,1fr)_17.5rem] sm:p-4">
        <div className="flex min-h-0 flex-col lg:order-2">
          <Board key={turn ? `turn:${turn.id}` : `over:${game.index}`} client={client} turn={turn?.id ?? null} mine={myTurn} drawing={drawing}>
            <Overlay view={view} me={me} host={host} snapshot={snapshot} client={client} drawerName={drawerName} />
          </Board>
          <ErrorLine snapshot={snapshot} client={client} />
        </div>
        <Chat view={view} me={me} snapshot={snapshot} client={client} guessing={guessing} drawing={drawing} className="h-72 lg:order-3 lg:h-auto" />
        <Players view={view} me={me} host={host} client={client} className="lg:order-1" />
      </div>
    </div>
  );
}

function EndGame({ client }: { client: DrawClient }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button tone="quiet" onClick={() => setAsking(true)}>
        end game
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-[13px] text-muted">end it for everyone?</span>
      <Button onClick={() => setAsking(false)}>no</Button>
      <Button tone="solid" onClick={() => void client.act("lobby").then(() => setAsking(false))}>
        end
      </Button>
    </span>
  );
}

function Timer({ ends, urgent }: { ends: number; urgent: boolean }) {
  const now = useServerNow(250);
  const seconds = Math.max(0, Math.ceil((ends - now) / 1000));
  return (
    <span
      aria-label={`${seconds} seconds left`}
      className={`min-w-[3ch] text-right font-mono text-[20px] font-semibold tabular-nums ${urgent && seconds <= 10 ? "text-accent" : ""}`}
    >
      {seconds}
    </span>
  );
}

/** "_ _ _ _ _" with the hints, and how many letters in each word, as the guessers see it. */
function Mask({ mask }: { mask: string }) {
  const lengths = mask
    .split(" ")
    .filter(Boolean)
    .map((w) => w.length);
  return (
    <span className="flex min-w-0 items-baseline gap-3" aria-label={`the word: ${lengths.join(" and ")} letters`}>
      <span aria-hidden className="truncate font-mono text-[20px] font-semibold tracking-[0.35em]">
        {mask}
      </span>
      <sup aria-hidden className="text-[12px] text-muted">
        {lengths.join(" ")}
      </sup>
    </span>
  );
}

function WordLine({ turn, myTurn, word, drawerName, guessed }: { turn: TurnView | null; myTurn: boolean; word: string | null; drawerName: string; guessed: boolean }) {
  if (!turn) return <span className="text-muted">thanks for playing</span>;
  if (turn.phase === "choosing") return <span className="text-muted">{myTurn ? "pick a word to draw" : `${drawerName} is picking a word…`}</span>;
  if (turn.phase === "reveal") {
    return (
      <span>
        the word was <span className="font-semibold">{turn.word}</span>
      </span>
    );
  }
  if (myTurn) {
    return word ? (
      <span>
        draw <span className="text-[18px] font-semibold">{word}</span>
      </span>
    ) : (
      <Spinner />
    );
  }
  if (guessed && word) {
    return (
      <span className="text-[#2b8a3e] dark:text-[#69db7c]">
        <span className="text-[18px] font-semibold">{word}</span> · you got it
      </span>
    );
  }
  return turn.mask ? <Mask mask={turn.mask} /> : null;
}

/* ------------------------------------------------------------ overlays */

function Overlay({ view, me, host, snapshot, client, drawerName }: { view: View; me: string; host: boolean; snapshot: Snapshot; client: DrawClient; drawerName: string }) {
  const game = view.game!;
  const turn = game.turn;
  if (game.phase === "final" || !turn) return <Final view={view} me={me} host={host} snapshot={snapshot} client={client} />;
  if (turn.phase === "choosing") {
    const options = snapshot.mine?.turn === turn.id ? snapshot.mine.options : null;
    return turn.drawer === me ? (
      <Cover>
        <p className="text-[15px]">pick a word to draw</p>
        {options ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {options.map((option, i) => (
              <button
                key={option}
                type="button"
                disabled={snapshot.busy}
                onClick={() => void client.act("choose", { turn: turn.id, i })}
                className="rounded-lg border-2 border-white/90 px-4 py-2 text-[17px] font-semibold text-white transition-colors hover:bg-white hover:text-neutral-900 disabled:opacity-60"
              >
                {option}
              </button>
            ))}
          </div>
        ) : (
          <Spinner className="mt-4" />
        )}
        <p className="mt-4 text-[12.5px] text-white/70">
          if you don&rsquo;t pick in <Seconds until={turn.ends} />, the first one it is.
        </p>
      </Cover>
    ) : (
      <Cover>
        <p className="text-[16px]">
          <span className="font-semibold">{drawerName}</span> is picking a word…
        </p>
      </Cover>
    );
  }
  if (turn.phase === "reveal") return <Reveal view={view} turn={turn} me={me} />;
  return null;
}

function Seconds({ until }: { until: number }) {
  const now = useServerNow(250);
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return <>{plural(seconds, "second")}</>;
}

function Cover({ children, solid = false }: { children: ReactNode; solid?: boolean }) {
  return (
    <div className={`absolute inset-0 grid place-items-center overflow-y-auto p-4 text-center text-white ${solid ? "bg-neutral-900/92" : "bg-neutral-900/75"}`}>
      <div className="animate-fade-in">{children}</div>
    </div>
  );
}

function Reveal({ view, turn, me }: { view: View; turn: TurnView; me: string }) {
  const gained = turn.gained ?? {};
  const rows = view.players
    .filter((p) => p.active || p.id in gained)
    .map((player) => ({ player, points: gained[player.id] ?? 0 }))
    .sort((a, b) => b.points - a.points || a.player.name.localeCompare(b.player.name));
  const nobody = turn.guessed.length === 0;
  return (
    <Cover>
      <p className="text-[14px] text-white/80">the word was</p>
      <p className="mt-1 text-[26px] font-semibold leading-tight">{turn.word}</p>
      {nobody && <p className="mt-1 text-[13px] text-white/70">nobody got it</p>}
      <ul className="mx-auto mt-4 w-[min(18rem,100%)] space-y-0.5 text-left text-[14px]">
        {rows.slice(0, 8).map(({ player, points }) => (
          <li key={player.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              {player.name}
              {player.id === me && <span className="text-white/60"> (you)</span>}
              {player.id === turn.drawer && <span className="text-white/60"> · drew</span>}
            </span>
            <span className={`font-mono tabular-nums ${points > 0 ? "text-[#8ce99a]" : "text-white/50"}`}>+{points}</span>
          </li>
        ))}
      </ul>
    </Cover>
  );
}

const PODIUM = ["#e8b923", "#b8bec6", "#c9824a"];

function Final({ view, me, host, snapshot, client }: { view: View; me: string; host: boolean; snapshot: Snapshot; client: DrawClient }) {
  const table = standings(view.players);
  const hostName = view.players.find((p) => p.id === view.host)?.name ?? "the host";
  const enough = view.players.filter((p) => p.active).length >= MIN_PLAYERS;
  return (
    <Cover solid>
      <p className="text-[14px] text-white/80">game over</p>
      <p className="mt-1 text-[24px] font-semibold leading-tight">
        {table[0] ? (table.filter((r) => r.rank === 1).length > 1 ? "it's a tie!" : `${table[0].player.name} wins!`) : "nobody played"}
      </p>
      <ol className="mx-auto mt-4 w-[min(20rem,100%)] space-y-1 text-left text-[14px]">
        {table.slice(0, 8).map(({ player, rank }) => (
          <li key={player.id} className="flex items-center gap-2.5">
            <span className="w-8 shrink-0 font-mono text-[12.5px]" style={{ color: PODIUM[rank - 1] ?? "rgb(255 255 255 / 0.6)" }}>
              {ordinal(rank)}
            </span>
            <span className={`min-w-0 flex-1 truncate ${rank === 1 ? "font-semibold" : ""}`}>
              {player.name}
              {player.id === me && <span className="text-white/60"> (you)</span>}
            </span>
            <span className="font-mono tabular-nums">{player.score}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {host ? (
          <>
            <button
              type="button"
              disabled={!enough || snapshot.busy}
              onClick={() => void client.act("start")}
              className="min-h-9 rounded-lg bg-white px-4 text-[13.5px] font-semibold text-neutral-900 hover:bg-white/90 disabled:opacity-60"
            >
              play again
            </button>
            <button
              type="button"
              disabled={snapshot.busy}
              onClick={() => void client.act("lobby")}
              className="min-h-9 rounded-lg border border-white/60 px-4 text-[13.5px] font-medium hover:bg-white/10 disabled:opacity-60"
            >
              change settings
            </button>
          </>
        ) : (
          <p className="text-[13px] text-white/70">waiting for {hostName} to start another…</p>
        )}
      </div>
      {host && !enough && <p className="mt-2 text-[12.5px] text-white/70">you need at least {MIN_PLAYERS} players for another game.</p>}
    </Cover>
  );
}

/* ------------------------------------------------------------- players */

function Players({ view, me, host, client, className = "" }: { view: View; me: string; host: boolean; client: DrawClient; className?: string }) {
  const turn = view.game?.turn ?? null;
  return (
    <section aria-label="players" className={`min-h-0 overflow-y-auto ${className}`}>
      <ol className="space-y-1">
        {standings(view.players).map(({ player, rank }) => {
          const guessed = turn?.guessed.includes(player.id) ?? false;
          const drawer = turn?.drawer === player.id;
          return (
            <li
              key={player.id}
              className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${guessed ? "bg-[#d3f9d8] dark:bg-[#1f3d25]" : "bg-ink/[0.035]"} ${player.active ? "" : "opacity-50"}`}
            >
              <span className="w-6 shrink-0 font-mono text-[12px] text-muted">#{rank}</span>
              <Dot color={player.color} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-medium">
                  {player.name}
                  {player.id === me && <span className="font-normal text-muted"> (you)</span>}
                </span>
                <span className="block text-[12px] text-muted">
                  {player.score} points
                  {!player.active ? " · left" : player.away ? " · away" : ""}
                </span>
              </span>
              {drawer && (
                <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="drawing">
                  <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
              )}
              {host && player.active && player.id !== me && (
                <button
                  type="button"
                  onClick={() => void client.act("kick", { target: player.id })}
                  title={`remove ${player.name}`}
                  aria-label={`remove ${player.name}`}
                  className="text-[15px] leading-none text-muted opacity-0 transition-opacity hover:text-accent focus:opacity-100 group-hover:opacity-100"
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------------------------------------------------------------- chat */

type Line =
  | { key: string; t: number; kind: "chat"; p: string; n: string; text: string }
  | { key: string; t: number; kind: "note"; note: NoteView }
  | { key: string; t: number; kind: "local"; line: LocalLine };

const SHOWN_LINES = 100;
const SEND_GAP_MS = 350;

function Chat({
  view,
  me,
  snapshot,
  client,
  guessing,
  drawing,
  className = "",
}: {
  view: View;
  me: string;
  snapshot: Snapshot;
  client: DrawClient;
  guessing: boolean;
  drawing: boolean;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const lastSent = useRef(0);
  const [text, setText] = useState("");

  const lines = useMemo(() => {
    const out: Line[] = [];
    const counts = new Map<string, number>();
    const key = (base: string) => {
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      return `${base}#${n}`;
    };
    for (const c of view.chat) out.push({ key: key(`c:${c.t}:${c.p}:${c.text}`), t: c.t, kind: "chat", p: c.p, n: c.n, text: c.text });
    for (const note of view.notes) {
      const detail = "p" in note ? note.p : "word" in note ? note.word : "round" in note ? note.round : "";
      out.push({ key: key(`n:${note.t}:${note.kind}:${detail}`), t: note.t, kind: "note", note });
    }
    for (const line of snapshot.local) out.push({ key: `l:${line.id}`, t: line.t, kind: "local", line });
    // Stable, so lines from the same moment keep the order they came in.
    out.sort((a, b) => a.t - b.t);
    return out.slice(-SHOWN_LINES);
  }, [view.chat, view.notes, snapshot.local]);

  // Stay at the bottom as lines come in, unless you've scrolled up to read.
  useEffect(() => {
    const element = list.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  // Typing anywhere on the page types into the chat.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (target && target !== document.body && target.tagName !== "CANVAS") return;
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || Date.now() - lastSent.current < SEND_GAP_MS) return;
    lastSent.current = Date.now();
    setText("");
    stick.current = true;
    void client.say(message);
  };

  const colors = useMemo(() => new Map(view.players.map((p) => [p.id, p.color])), [view.players]);

  return (
    <section aria-label="chat" className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-faint/60 ${className}`}>
      <div
        ref={list}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2 text-[13.5px] leading-snug"
      >
        {lines.length === 0 && <p className="text-muted">guesses and chat go here.</p>}
        {lines.map((line) => (
          <ChatRow key={line.key} line={line} me={me} color={colors.get(line.kind === "chat" ? line.p : "")} />
        ))}
      </div>
      <form onSubmit={submit} className="border-t border-faint/60 p-1.5">
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          aria-label={guessing ? "your guess" : "chat"}
          placeholder={guessing ? "type your guess here…" : drawing ? "chat (no giving the word away)" : "chat…"}
          className="min-h-9 w-full rounded-md bg-transparent px-2 text-[14px] outline-none placeholder:text-muted/80 focus:bg-ink/[0.04]"
        />
      </form>
    </section>
  );
}

function ChatRow({ line, me, color }: { line: Line; me: string; color?: string }) {
  if (line.kind === "chat") {
    return (
      <p className="break-words py-0.5">
        <span className="font-semibold" style={{ color }}>
          {line.p === me ? "you" : line.n}
        </span>
        : {line.text}
      </p>
    );
  }
  if (line.kind === "local") {
    const { kind, text } = line.line;
    if (kind === "pending") {
      return (
        <p className="break-words py-0.5 opacity-55">
          <span className="font-semibold">you</span>: {text}
        </p>
      );
    }
    if (kind === "close") return <p className="break-words py-0.5 font-medium text-[#e67700] dark:text-[#ffc078]">&ldquo;{text}&rdquo; is close!</p>;
    if (kind === "hidden") return <p className="break-words py-0.5 text-muted">&ldquo;{text}&rdquo; would give the word away, so only you can see it.</p>;
    return <p className="break-words py-0.5 text-accent">couldn&rsquo;t send &ldquo;{text}&rdquo;; check your connection.</p>;
  }
  const note = line.note;
  const who = note.name ?? "someone";
  switch (note.kind) {
    case "guessed":
      return (
        <p className="my-0.5 rounded bg-[#d3f9d8] px-1.5 py-0.5 font-semibold text-[#2b8a3e] dark:bg-[#1f3d25] dark:text-[#8ce99a]">
          {note.p === me ? "you guessed the word!" : `${who} guessed the word!`}
        </p>
      );
    case "drawing":
      return <p className="py-0.5 font-medium text-[#1971c2] dark:text-[#74c0fc]">{note.p === me ? "your turn to draw" : `${who} is drawing now`}</p>;
    case "word":
      return (
        <p className="py-0.5 text-muted">
          the word was <span className="font-semibold text-ink">{note.word}</span>
        </p>
      );
    case "round":
      return <p className="mt-1 py-0.5 font-semibold">round {note.round}</p>;
    case "over":
      return <p className="mt-1 py-0.5 font-semibold">game over</p>;
    case "join":
      return <p className="py-0.5 text-[#2b8a3e] dark:text-[#8ce99a]">{who} joined</p>;
    case "leave":
      return <p className="py-0.5 text-accent">{who} left</p>;
    case "kicked":
      return <p className="py-0.5 text-accent">{who} was removed</p>;
  }
}
