"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  DEFAULT_ROUNDS,
  MAX_CUSTOM_WORDS,
  MIN_TURNS_PLAYERS,
  ROUND_CHOICES,
  TIME_CHOICES,
  type GameView,
  type Mode,
  type MyRound,
  type PlayerView,
  type RoomView,
  type RoundSummary,
  type Settings,
} from "@/lib/hang/room";
import { LIVES, sameWord } from "@/lib/hang/words";
import { useServerNow } from "@/components/game/clock";
import { Connecting, Crumbs, ErrorLine, JoinForm, Leave, RoomGone, Shell, useAutoJoin, type GameName } from "@/components/game/room-ui";
import { Button, Choice, Spinner, ordinal, plural } from "@/components/game/ui";
import { WordsEditor } from "@/components/game/WordsEditor";
import { Gallows } from "./Gallows";
import { useHangRoom, type HangClient, type Snapshot } from "./room-client";

/** Set by the menu when you type a code with your name already in, so you go straight in. */
export const JOIN_FLAG = "hang:join";

const GAME: GameName = { name: "hang", href: "/hang" };

const GREEN_BG = "bg-[#d3f9d8] dark:bg-[#1f3d25]";
const GREEN_TEXT = "text-[#2b8a3e] dark:text-[#8ce99a]";

export function Room({ code }: { code: string }) {
  const [snapshot, client] = useHangRoom(code);
  const { status, view, me } = snapshot;
  useAutoJoin(JOIN_FLAG, code, snapshot, client);

  const gone = RoomGone({ game: GAME, code, status });
  if (gone) return gone;
  if (!view) return <Connecting game={GAME} code={code} />;

  const seated = me !== null && view.players.some((p) => p.id === me && p.active);
  if (!seated) {
    const note = view.game && view.game.phase !== "final" ? "a game is on; you'll join straight in with the next letter." : "";
    return <JoinForm game={GAME} code={code} players={view.players} note={note} snapshot={snapshot} client={client} />;
  }
  if (!view.game) return <Lobby view={view} me={me!} snapshot={snapshot} client={client} />;
  if (view.game.phase === "final") return <Final view={view} me={me!} snapshot={snapshot} client={client} />;
  return <Play view={view} me={me!} snapshot={snapshot} client={client} />;
}

/* ------------------------------------------------------------- helpers */

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** "4.2s" for a quick one, "37s" for the rest. */
const seconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);

const nameOf = (view: RoomView, id: string | null) => view.players.find((p) => p.id === id)?.name ?? "someone";

/** This word, as you have it, if what's here is about the word that's on. */
function myRound(snapshot: Snapshot, game: GameView): MyRound | null {
  const round = snapshot.mine?.round;
  return round && round.game === game.index && round.round === game.round ? round : null;
}

function standings(players: PlayerView[]) {
  const rows = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // Equal scores share a place.
  return rows.map((player) => ({ player, rank: rows.findIndex((r) => r.score === player.score) + 1 }));
}

/* --------------------------------------------------------------- lobby */

const MODE_BLURBS: Record<Mode, string> = {
  race: "the game picks the words, and everyone races to get each one first.",
  turns: "each of you picks a word for everyone else, and scores for every piece of them it costs.",
};

function Lobby({ view, me, snapshot, client }: { view: RoomView; me: string; snapshot: Snapshot; client: HangClient }) {
  const host = view.host === me;
  const players = view.players.filter((p) => p.active);
  const hostName = nameOf(view, view.host);
  // The host's own words come separately, since they're the answers.
  const words = host ? (snapshot.mine?.words ?? null) : null;
  const [pending, setPending] = useState<Settings | null>(null);
  const settings: Settings = pending ?? { ...view.settings, words: words ?? [] };
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
    const text = what === "code" ? view.code : `${window.location.origin}/hang/${view.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  };

  const enough = settings.mode === "race" || players.length >= MIN_TURNS_PLAYERS;

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
        friends go to <span className="text-ink">{window.location.host}/hang</span> and type the code.
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
          <div className="flex flex-col gap-1.5">
            <Row label="who picks the words">
              <Choice selected={settings.mode === "race"} onSelect={() => void change({ mode: "race", rounds: DEFAULT_ROUNDS.race })} disabled={!editable}>
                the game: race
              </Choice>
              <Choice selected={settings.mode === "turns"} onSelect={() => void change({ mode: "turns", rounds: DEFAULT_ROUNDS.turns })} disabled={!editable}>
                you: take turns
              </Choice>
            </Row>
            <p className="text-[12.5px] text-muted">{MODE_BLURBS[settings.mode]}</p>
          </div>
          <Row label={settings.mode === "race" ? "words" : "times round (everyone picks once each time)"}>
            {ROUND_CHOICES[settings.mode].map((rounds) => (
              <Choice key={rounds} selected={settings.rounds === rounds} onSelect={() => void change({ rounds })} disabled={!editable}>
                {rounds}
              </Choice>
            ))}
          </Row>
          <Row label="time for each word">
            {TIME_CHOICES.map((time) => (
              <Choice key={time} selected={settings.time === time} onSelect={() => void change({ time })} disabled={!editable}>
                {time}s
              </Choice>
            ))}
          </Row>
          {host ? (
            <WordsEditor words={settings.words} only={settings.only} max={MAX_CUSTOM_WORDS} disabled={!editable} onChange={(patch) => void change(patch)} />
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
            {!enough && <span className="text-muted">taking turns needs at least {MIN_TURNS_PLAYERS} players: send someone the code.</span>}
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
          everyone gets the same word, with a clue, and guesses on their own board. tap letters or type them: a right one shows up
          everywhere it comes, and a wrong one draws another piece of your hangman. six wrong and you&rsquo;re hanged. sure you know
          it? type the whole thing, but a wrong go costs a piece too. every letter you find scores a little, and getting the word
          scores a lot more the sooner you do and the more of you is left.
        </p>
      </section>
    </Shell>
  );
}

/* ---------------------------------------------------------------- play */

function Play({ view, me, snapshot, client }: { view: RoomView; me: string; snapshot: Snapshot; client: HangClient }) {
  const game = view.game!;
  const host = view.host === me;
  const setterName = nameOf(view, game.setter);
  const mine = myRound(snapshot, game);
  const setter = game.setter === me;
  const board = game.boards[me];
  const done = !setter && !!board && (board.took !== null || board.hanged);
  // Watching the others, the big grid of everyone shows it better than the list does, on a phone.
  const watching = game.phase === "playing" && (setter || done);

  const where =
    game.phase === "countdown"
      ? "get ready"
      : game.mode === "race"
        ? `word ${game.round + 1} of ${game.words}`
        : `round ${game.pass} of ${game.passes} · ${game.setter === me ? "your" : `${setterName}’s`} ${game.phase === "choosing" ? "pick" : "word"}`;

  let stage: ReactNode;
  if (game.phase === "countdown") stage = <Countdown ends={game.ends} />;
  else if (game.phase === "choosing") stage = setter ? <Pick game={game} mine={mine} snapshot={snapshot} client={client} /> : <Picking name={setterName} ends={game.ends} />;
  else if (game.phase === "reveal") stage = <Reveal view={view} me={me} mine={mine} />;
  else if (setter) stage = <Hangman view={view} me={me} mine={mine} />;
  else stage = <Guessing key={`${game.index}.${game.round}`} view={view} me={me} mine={mine} snapshot={snapshot} client={client} />;

  return (
    <div className="flex min-h-dvh flex-col text-[14px]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-faint/50 px-3 py-2 sm:gap-x-4 sm:px-4">
        <Crumbs game={GAME} code={view.code} compact />
        <span className="min-w-0 truncate text-[13px] text-muted">{where}</span>
        <span className="flex-1" />
        {(game.phase === "playing" || game.phase === "choosing") && <Timer ends={game.ends} urgent={game.phase === "playing"} />}
        <div className="flex items-center gap-1">
          {host && <EndGame client={client} />}
          <Leave game={GAME} client={client} label="leave" />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[64rem] flex-1 content-start gap-6 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="min-w-0">
          {stage}
          <ErrorLine snapshot={snapshot} client={client} />
        </section>
        <aside aria-label="players" className={`min-w-0 ${watching ? "hidden lg:block" : ""}`}>
          <Players view={view} me={me} host={host} client={client} />
        </aside>
      </main>
    </div>
  );
}

function Timer({ ends, urgent }: { ends: number; urgent: boolean }) {
  const now = useServerNow(250);
  const left = Math.max(0, Math.ceil((ends - now) / 1000));
  return (
    <span aria-label={`${left} seconds left`} className={`min-w-[3ch] text-right font-mono text-[20px] font-semibold tabular-nums ${urgent && left <= 10 ? "text-accent" : ""}`}>
      {left}
    </span>
  );
}

function Seconds({ until }: { until: number }) {
  const now = useServerNow(250);
  return <>{plural(Math.max(0, Math.ceil((until - now) / 1000)), "second")}</>;
}

function EndGame({ client }: { client: HangClient }) {
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

function Countdown({ ends }: { ends: number }) {
  const now = useServerNow(100);
  const left = Math.max(1, Math.ceil((ends - now) / 1000));
  return (
    <div className="grid min-h-[min(46vh,360px)] place-items-center rounded-2xl bg-ink/[0.035]">
      <p className="text-center">
        <span className="block text-[13px] text-muted">first word in</span>
        <span key={left} className="block animate-pop font-mono text-[72px] font-semibold leading-none tabular-nums">
          {left}
        </span>
      </p>
    </div>
  );
}

/** What the word's category says, or that it's one of the host's. */
function Clue({ clue }: { clue: string | null }) {
  return (
    <p className="text-[13px] text-muted">
      {clue ? "clue: " : ""}
      <span className="rounded-full bg-ink/[0.07] px-2.5 py-0.5 font-medium text-ink">{clue ?? "one of the host’s own words"}</span>
    </p>
  );
}

/* --------------------------------------------------------- picking */

function Pick({ game, mine, snapshot, client }: { game: GameView; mine: MyRound | null; snapshot: Snapshot; client: HangClient }) {
  const options = mine?.options ?? null;
  return (
    <div className="rounded-2xl bg-ink/[0.035] px-4 py-8 text-center sm:py-12">
      <Gallows misses={0} className="mx-auto h-24 w-auto text-ink" still />
      <h1 className="mt-3 text-[20px] font-semibold tracking-tight">you&rsquo;re the hangman</h1>
      <p className="mt-1 text-muted">pick a word for everyone else. you score for every piece of them it costs.</p>
      {options ? (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {options.map((option, i) => (
            <button
              key={option.text}
              type="button"
              disabled={snapshot.busy}
              onClick={() => void client.choose(i)}
              className="flex min-w-[9rem] flex-col items-center rounded-xl border-2 border-ink/80 px-4 py-2.5 transition-colors hover:bg-ink hover:text-paper disabled:opacity-60"
            >
              <span className="text-[18px] font-semibold">{option.text}</span>
              <span className="text-[12px] opacity-70">{option.clue ?? "one of your own"}</span>
            </button>
          ))}
        </div>
      ) : (
        <Spinner className="mt-6" />
      )}
      <p className="mt-5 text-[12.5px] text-muted">
        if you don&rsquo;t pick in <Seconds until={game.ends} />, the first one it is.
      </p>
    </div>
  );
}

function Picking({ name, ends }: { name: string; ends: number }) {
  return (
    <div className="grid min-h-[min(46vh,360px)] place-items-center rounded-2xl bg-ink/[0.035] px-4 text-center">
      <div className="animate-fade-in">
        <Gallows misses={0} className="mx-auto h-24 w-auto text-ink" still />
        <p className="mt-4 text-[16px]">
          <span className="font-semibold">{name}</span> is picking a word to hang you with…
        </p>
        <p className="mt-1 text-[12.5px] text-muted">
          at most <Seconds until={ends} />
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- guessing */

const LETTERS = Array.from("abcdefghijklmnopqrstuvwxyz");

function Guessing({ view, me, mine, snapshot, client }: { view: RoomView; me: string; mine: MyRound | null; snapshot: Snapshot; client: HangClient }) {
  const game = view.game!;
  const pattern = game.pattern!;
  const guesses = mine?.guesses ?? [];
  const mask = mine?.mask ?? pattern;
  const misses = mine?.misses ?? game.boards[me]?.misses ?? 0;
  const board = game.boards[me];
  const solved = mine?.solved ?? board?.took != null;
  const hanged = mine?.hanged ?? board?.hanged ?? false;
  const open = !solved && !hanged;
  const tried = [...guesses, ...snapshot.pending].join(",");

  // Type letters anywhere on the page to guess them.
  useEffect(() => {
    if (!open) return;
    const taken = new Set(tried.split(","));
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key.length !== 1 || key < "a" || key > "z" || taken.has(key)) return;
      event.preventDefault();
      void client.guess(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, tried, client]);

  // A wrong one gives the gallows a shake.
  const shaker = useRef<HTMLDivElement>(null);
  const lastMisses = useRef(misses);
  useEffect(() => {
    const grew = misses > lastMisses.current;
    lastMisses.current = misses;
    if (!grew || !shaker.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    shaker.current.animate([{ transform: "none" }, { transform: "translateX(-7px) rotate(-2deg)" }, { transform: "translateX(6px) rotate(2deg)" }, { transform: "translateX(-3px)" }, { transform: "none" }], {
      duration: 380,
      easing: "ease-out",
    });
  }, [misses]);

  const wrongWords = guesses.filter((g) => g.length > 1 && (!solved || g !== guesses.at(-1)));
  const place = board?.place ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Clue clue={game.clue} />
        <Lives misses={misses} />
      </div>

      <div className="mt-4 grid items-center gap-x-6 gap-y-4 rounded-2xl bg-ink/[0.035] p-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:p-6">
        <div ref={shaker} className="justify-self-center">
          <Gallows misses={misses} solved={solved} className="h-32 w-auto text-ink sm:h-40" />
        </div>
        <Tiles pattern={pattern} mask={mask} />
      </div>

      {solved ? (
        <div className={`mt-4 animate-pop rounded-xl px-4 py-3 text-center ${GREEN_BG} ${GREEN_TEXT}`}>
          <p className="text-[18px] font-semibold">
            got it{place === 1 ? ", first!" : "!"} +{board?.points ?? 0}
          </p>
          <p className="text-[13px] opacity-80">
            {board?.took != null ? `in ${seconds(board.took)}` : ""}
            {place && place > 1 ? `, ${ordinal(place)} to get it` : ""}. now watch the others sweat.
          </p>
        </div>
      ) : hanged ? (
        <div className="mt-4 animate-pop rounded-xl bg-accent/10 px-4 py-3 text-center text-accent">
          <p className="text-[18px] font-semibold">hanged!</p>
          <p className="text-[13px] opacity-80">the word comes out once everyone&rsquo;s done. see how the others are getting on.</p>
        </div>
      ) : (
        <>
          <Keyboard guesses={guesses} pending={snapshot.pending} mask={mask} onGuess={(letter) => void client.guess(letter)} />
          <SolveForm pending={snapshot.pending.some((p) => p.length > 1)} onSolve={(text) => void client.guess(text)} />
        </>
      )}

      {wrongWords.length > 0 && (
        <p className="mt-3 text-[13px] text-muted">
          not {wrongWords.map((w, i) => (
            <span key={w}>
              {i > 0 && ", "}
              <span className="line-through decoration-accent/70">{w}</span>
            </span>
          ))}
        </p>
      )}

      {!open && <Watch view={view} me={me} />}
    </div>
  );
}

/** Six marks, one for each piece you've still got. */
function Lives({ misses }: { misses: number }) {
  const left = Math.max(0, LIVES - misses);
  return (
    <span className="flex items-center gap-2 text-[12.5px] text-muted" aria-label={`${plural(left, "life", "lives")} left`}>
      <span aria-hidden className="flex gap-1">
        {Array.from({ length: LIVES }, (_, i) => (
          <span key={i} className={`size-2.5 rounded-full transition-colors ${i < left ? "bg-ink" : "bg-accent/30"}`} />
        ))}
      </span>
      {plural(left, "life", "lives")} left
    </span>
  );
}

/**
 * The word as tiles, one per letter: blank until found, found letters
 * popping in. Once it's over, the letters you never found show in red.
 */
function Tiles({ pattern, mask, word = null }: { pattern: string; mask: string; word?: string | null }) {
  const words: { start: number; text: string }[] = [];
  Array.from(pattern).forEach((ch, i) => {
    if (ch === " ") return;
    const last = words.at(-1);
    if (last && last.start + last.text.length === i) last.text += ch;
    else words.push({ start: i, text: ch });
  });
  const longest = Math.max(1, ...words.map((w) => w.text.length));
  const px = longest <= 6 ? 40 : longest <= 9 ? 32 : longest <= 12 ? 26 : 21;
  const spoken = Array.from(mask, (ch) => (ch === "_" ? "blank" : ch === " " ? "space" : ch)).join(" ");
  return (
    <div
      role="img"
      aria-label={`the word: ${spoken}`}
      className="flex min-w-0 flex-wrap justify-center gap-x-[0.8em] gap-y-[0.35em] font-mono font-semibold uppercase leading-none"
      style={{ fontSize: `min(${px}px, calc((100vw - 4rem) / ${(longest * 1.3).toFixed(1)}))` }}
    >
      {words.map(({ start, text }) => (
        <span key={start} aria-hidden className="flex gap-[0.16em]">
          {Array.from(text).map((ch, j) => {
            const i = start + j;
            if (ch !== "_") {
              return (
                <span key={i} className="grid h-[1.4em] w-[0.6em] place-items-center">
                  {ch}
                </span>
              );
            }
            const found = mask[i] !== "_" ? mask[i] : null;
            const missed = !found && word ? word[i] : null;
            return (
              <span key={i} className="grid h-[1.4em] w-[1.05em] place-items-center border-b-[0.1em] border-ink/35">
                {found ? (
                  <span key={found} className="animate-pop">
                    {found}
                  </span>
                ) : missed ? (
                  <span className="animate-fade-in text-accent">{missed}</span>
                ) : null}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}

const KEY_STYLES = {
  open: "bg-ink/[0.07] text-ink hover:bg-ink/[0.14] active:scale-95",
  pending: "animate-pulse bg-ink/[0.07] text-muted",
  hit: `${GREEN_BG} ${GREEN_TEXT}`,
  miss: "bg-transparent text-faint line-through decoration-accent/70",
} as const;

function Keyboard({ guesses, pending, mask, onGuess }: { guesses: string[]; pending: string[]; mask: string; onGuess: (letter: string) => void }) {
  return (
    <div role="group" aria-label="letters" className="mx-auto mt-5 grid max-w-[44rem] grid-cols-7 gap-1.5 sm:grid-cols-13">
      {LETTERS.map((letter, i) => {
        const state = guesses.includes(letter) ? (mask.includes(letter) ? "hit" : "miss") : pending.includes(letter) ? "pending" : "open";
        return (
          <button
            key={letter}
            type="button"
            disabled={state !== "open"}
            onClick={() => onGuess(letter)}
            aria-label={`${letter}${state === "hit" ? ", in it" : state === "miss" ? ", not in it" : ""}`}
            // The last five sit in the middle of their row on a phone.
            className={`h-12 rounded-lg text-[18px] font-semibold uppercase transition sm:h-11 disabled:cursor-default ${i === 21 ? "col-start-2 sm:col-start-auto" : ""} ${KEY_STYLES[state]}`}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}

function SolveForm({ pending, onSolve }: { pending: boolean; onSolve: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const guess = text.trim();
    if (!guess || pending) return;
    onSolve(guess);
    setText("");
  };
  return (
    <form onSubmit={submit} className="mx-auto mt-4 max-w-[44rem]">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          aria-label="the whole word"
          placeholder="know it? type the whole thing"
          // 16px on phones, or iPhones zoom in when it's tapped.
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-faint bg-paper px-3 text-[16px] outline-none placeholder:text-faint focus:border-ink sm:text-[15px]"
        />
        <Button tone="solid" type="submit" disabled={!text.trim() || pending} className="min-h-11 px-5">
          {pending ? <Spinner /> : "solve"}
        </Button>
      </div>
      <p className="mt-1.5 text-[12px] text-muted">a wrong go costs a piece, just like a wrong letter.</p>
    </form>
  );
}

/* ------------------------------------------------------------- watching */

function Hangman({ view, me, mine }: { view: RoomView; me: string; mine: MyRound | null }) {
  const game = view.game!;
  return (
    <div>
      <div className="rounded-2xl bg-ink/[0.035] px-4 py-5 text-center">
        <p className="text-[13px] text-muted">you picked</p>
        <div className="mt-2">{mine?.word ? <Tiles pattern={game.pattern!} mask={mine.word} /> : <Spinner />}</div>
        <div className="mt-3 flex justify-center">
          <Clue clue={game.clue} />
        </div>
        <p className="mt-3 text-[13px] text-muted">you score for every piece they lose. no helping!</p>
      </div>
      <Watch view={view} me={me} />
    </div>
  );
}

/** Everyone else's hangman, big, for whoever's done or picked the word. */
function Watch({ view, me }: { view: RoomView; me: string }) {
  const game = view.game!;
  const others = view.players.filter((p) => p.id !== game.setter && p.id !== me && (p.active || game.boards[p.id]));
  if (others.length === 0) return null;
  const still = others.filter((p) => {
    const b = game.boards[p.id];
    return p.active && !(b && (b.took !== null || b.hanged));
  }).length;
  return (
    <section aria-labelledby="watch" className="mt-6">
      <h2 id="watch" className="text-[13px] text-muted">
        {still > 0 ? `${plural(still, "person", "people")} still going` : "everyone's done"}
      </h2>
      <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {others.map((player) => {
          const board = game.boards[player.id];
          const solved = board?.took != null;
          return (
            <li key={player.id} className={`rounded-xl p-2 text-center ${solved ? GREEN_BG : board?.hanged ? "bg-accent/10" : "bg-ink/[0.035]"} ${player.active ? "" : "opacity-50"}`}>
              <Gallows misses={board?.misses ?? 0} solved={solved} className="mx-auto h-16 w-auto text-ink sm:h-20" />
              <span className="mt-1 flex items-center justify-center gap-1.5 text-[13px] font-medium">
                <Dot color={player.color} />
                <span className="truncate">{player.name}</span>
              </span>
              <BoardLine game={game} player={player} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Where someone's got to with this word, in a few words. */
function BoardLine({ game, player }: { game: GameView; player: PlayerView }) {
  const board = game.boards[player.id];
  if (game.setter === player.id) return <span className="block text-[12px] text-muted">{game.phase === "choosing" ? "picking a word…" : game.phase === "reveal" ? `the hangman · +${game.setterPoints ?? 0}` : "the hangman"}</span>;
  if (game.phase === "reveal") return <span className="block text-[12px] text-muted">{board?.took != null ? `got it · +${board.points}` : board?.hanged ? `hanged · +${board.points}` : `+${board?.points ?? 0}`}</span>;
  if (board?.took != null) return <span className={`block text-[12px] font-medium ${GREEN_TEXT}`}>{`${ordinal(board.place!)} · ${seconds(board.took)}`}</span>;
  if (board?.hanged) return <span className="block text-[12px] font-medium text-accent">hanged</span>;
  if (game.phase !== "playing") return <span className="block text-[12px] text-muted">{!player.active ? "left" : player.away ? "away" : "ready"}</span>;
  const share = game.letters ? (board?.shown ?? 0) / game.letters : 0;
  return (
    <span className="mt-1 block" aria-label={`${board?.shown ?? 0} of ${game.letters} letters`}>
      <span className="block h-1.5 overflow-hidden rounded-full bg-ink/10">
        <span className="block h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span className="mt-0.5 block text-[11.5px] text-muted">
        {board?.shown ?? 0}/{game.letters} letters{!player.active ? " · left" : player.away ? " · away" : ""}
      </span>
    </span>
  );
}

function Players({ view, me, host, client }: { view: RoomView; me: string; host: boolean; client: HangClient }) {
  const game = view.game!;
  return (
    <ol className="space-y-1">
      {standings(view.players).map(({ player, rank }) => {
        const board = game.boards[player.id];
        const solved = board?.took != null;
        const picker = game.setter === player.id;
        return (
          <li
            key={player.id}
            className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${solved ? GREEN_BG : board?.hanged ? "bg-accent/10" : "bg-ink/[0.035]"} ${player.active ? "" : "opacity-50"}`}
          >
            <span className="w-6 shrink-0 font-mono text-[12px] text-muted">#{rank}</span>
            <Gallows misses={picker ? 0 : (board?.misses ?? 0)} solved={solved} className={`h-10 w-auto shrink-0 text-ink ${picker ? "opacity-40" : ""}`} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="flex items-center gap-1.5 font-medium">
                <Dot color={player.color} />
                <span className="truncate">{player.name}</span>
                {player.id === me && <span className="shrink-0 font-normal text-muted">(you)</span>}
              </span>
              <BoardLine game={game} player={player} />
            </span>
            <span className="font-mono text-[13px] tabular-nums">{player.score}</span>
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
  );
}

/* --------------------------------------------------------------- reveal */

/** One thing someone tried, marked right or wrong now the word's out. */
function Tried({ guess, word }: { guess: string; word: string }) {
  const right = guess.length === 1 ? word.includes(guess) : sameWord(guess, word);
  return (
    <span className={`rounded px-1.5 py-px font-mono text-[12px] uppercase ${right ? `${GREEN_BG} ${GREEN_TEXT}` : "bg-ink/[0.06] text-muted line-through decoration-accent/70"}`}>{guess}</span>
  );
}

function Reveal({ view, me, mine }: { view: RoomView; me: string; mine: MyRound | null }) {
  const game = view.game!;
  const word = game.word!;
  const now = useServerNow(250);
  const left = Math.max(0, Math.ceil((game.ends - now) / 1000));
  const board = game.boards[me];
  const setter = game.setter === me;
  const last = game.mode === "race" && game.round + 1 >= (game.words ?? 0);
  const tried = view.players.filter((p) => game.boards[p.id]);
  const solvers = tried.filter((p) => game.boards[p.id].took !== null).length;

  let result: ReactNode;
  if (setter) result = `your word cost them ${plural(tried.reduce((sum, p) => sum + game.boards[p.id].misses, 0), "piece")}: +${game.setterPoints ?? 0}`;
  else if (board?.took != null) result = `you got it in ${seconds(board.took)}: +${board.points}`;
  else if (board?.hanged) result = `you were hanged${board.points ? `, but found enough for +${board.points}` : ""}`;
  else result = board ? `out of time: +${board.points}` : "you didn't have a go at this one";

  return (
    <div className="animate-fade-in">
      <div className="rounded-2xl bg-ink/[0.035] px-4 py-6 text-center">
        <p className="text-[13px] text-muted">it was</p>
        <div className="mt-2">
          <Tiles pattern={game.pattern!} mask={setter ? word : (mine?.mask ?? game.pattern!)} word={word} />
        </div>
        <div className="mt-3 flex justify-center">
          <Clue clue={game.clue} />
        </div>
        <p className={`mt-3 font-medium ${board?.took != null ? GREEN_TEXT : board?.hanged ? "text-accent" : ""}`}>{result}</p>
        <p className="mt-1 text-[12.5px] text-muted">
          {tried.length === 0 ? "nobody had a go" : solvers === 0 ? "nobody got it" : solvers === tried.length ? "everyone got it" : `${solvers} of ${tried.length} got it`}
          {game.mode === "turns" && !setter ? ` · ${nameOf(view, game.setter)} picked it` : ""} · {last ? "that was the last one" : `next in ${left}`}
        </p>
      </div>
      {tried.length > 0 && (
        <section aria-labelledby="tries" className="mt-5">
          <h2 id="tries" className="text-[13px] text-muted">
            what everyone tried
          </h2>
          <ul className="mt-2 space-y-1.5">
            {tried.map((player) => (
              <li key={player.id} className="flex items-start gap-2.5">
                <Gallows misses={game.boards[player.id].misses} solved={game.boards[player.id].took !== null} className="h-8 w-auto shrink-0 text-ink" still />
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium">{player.id === me ? "you" : player.name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {(game.boards[player.id].guesses ?? []).map((guess) => (
                      <Tried key={guess} guess={guess} word={word} />
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- final */

interface Award {
  title: string;
  who: string;
  detail: string;
}

/** A few honours from how the game went. Only for people still on the scoreboard, so there's a name to give. */
function awards(history: RoundSummary[], view: RoomView, me: string): Award[] {
  const names = new Map(view.players.map((p) => [p.id, p.id === me ? "you" : p.name]));
  const out: Award[] = [];
  const results = history.flatMap((round) => Object.entries(round.results).map(([id, r]) => ({ id, round, ...r })).filter((r) => names.has(r.id)));

  const quickest = results.filter((r) => r.took !== null).sort((a, b) => a.took! - b.took!)[0];
  if (quickest) out.push({ title: "quickest", who: names.get(quickest.id)!, detail: `${quickest.round.word} in ${seconds(quickest.took!)}` });

  const played = new Map<string, { words: number; misses: number; hanged: number }>();
  for (const r of results) {
    const entry = played.get(r.id) ?? { words: 0, misses: 0, hanged: 0 };
    entry.words++;
    entry.misses += r.misses;
    entry.hanged += r.hanged ? 1 : 0;
    played.set(r.id, entry);
  }
  const regulars = [...played].filter(([, p]) => p.words >= Math.max(2, Math.ceil(history.length / 2)));
  const sharpest = regulars.sort((a, b) => a[1].misses / a[1].words - b[1].misses / b[1].words)[0];
  if (sharpest && played.size > 1) {
    const [id, p] = sharpest;
    out.push({ title: "sharpest", who: names.get(id)!, detail: p.misses === 0 ? "not one wrong guess" : `${(p.misses / p.words).toFixed(1)} wrong a word` });
  }

  const hangings = [...played].sort((a, b) => b[1].hanged - a[1].hanged)[0];
  if (hangings && hangings[1].hanged > 0) out.push({ title: "most hanged", who: names.get(hangings[0])!, detail: hangings[1].hanged === 1 ? "once" : `${hangings[1].hanged} times` });

  const cruellest = history.filter((r) => r.setter && names.has(r.setter) && r.setterPoints > 0).sort((a, b) => b.setterPoints - a.setterPoints)[0];
  if (cruellest) out.push({ title: "cruellest hangman", who: names.get(cruellest.setter!)!, detail: `with ${cruellest.word}` });

  const hardest = history
    .filter((r) => Object.keys(r.results).length > 0)
    .map((r) => ({ r, share: Object.values(r.results).filter((x) => x.took !== null).length / Object.keys(r.results).length }))
    .sort((a, b) => a.share - b.share)[0];
  if (hardest && hardest.share < 1) out.push({ title: "hardest word", who: hardest.r.word, detail: hardest.share === 0 ? "nobody got it" : `${Math.round(hardest.share * 100)}% got it` });
  return out;
}

const PODIUM = ["#e8b923", "#9aa1a9", "#c9824a"];

function Final({ view, me, snapshot, client }: { view: RoomView; me: string; snapshot: Snapshot; client: HangClient }) {
  const game = view.game!;
  const host = view.host === me;
  const table = standings(view.players);
  const winners = table.filter((r) => r.rank === 1);
  const hostName = nameOf(view, view.host);
  const history = game.history ?? [];
  const honours = awards(history, view, me);
  const enough = view.settings.mode === "race" || view.players.filter((p) => p.active).length >= MIN_TURNS_PLAYERS;
  return (
    <Shell game={GAME} code={view.code}>
      <p className="text-[13px] text-muted">game over</p>
      <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
        {winners.length > 1 ? "it's a tie!" : winners[0] ? `${winners[0].player.id === me ? "you win" : `${winners[0].player.name} wins`}!` : "nobody played"}
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

      {honours.length > 0 && (
        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {honours.map((award) => (
            <li key={award.title} className="rounded-xl bg-ink/[0.035] px-3.5 py-2.5">
              <span className="block text-[12px] text-muted">{award.title}</span>
              <span className="block truncate text-[15px] font-semibold">{award.who}</span>
              <span className="block text-[12.5px] text-muted">{award.detail}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {host ? (
          <>
            <Button tone="solid" onClick={() => void client.act("start")} disabled={snapshot.busy || !enough} className="min-h-10 px-5">
              play again
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
      {host && !enough && <p className="mt-2 text-[12.5px] text-muted">taking turns needs at least {MIN_TURNS_PLAYERS} players for another game.</p>}
      <ErrorLine snapshot={snapshot} client={client} />

      {history.length > 0 && (
        <section aria-labelledby="words" className="mt-10">
          <h2 id="words" className="text-muted">
            the words
          </h2>
          <ol className="mt-3 space-y-1.5">
            {history.map((round, i) => {
              const entries = Object.entries(round.results);
              const got = entries.filter(([, r]) => r.took !== null);
              const first = got.sort((a, b) => a[1].took! - b[1].took!)[0];
              return (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-ink/[0.035] px-3 py-2">
                  <span className="font-mono text-[15px] font-semibold uppercase tracking-wide">{round.word}</span>
                  <span className="text-[12.5px] text-muted">{round.clue ?? "the host's own"}</span>
                  <span className="flex-1" />
                  <span className="text-[12.5px] text-muted">
                    {round.setter ? `${round.setter === me ? "your" : `${nameOf(view, round.setter)}’s`} pick · ` : ""}
                    {entries.length === 0 ? "nobody tried" : `${got.length}/${entries.length} got it`}
                    {first ? ` · first: ${first[0] === me ? "you" : nameOf(view, first[0])}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </Shell>
  );
}
