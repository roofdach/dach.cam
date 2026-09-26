"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { KEYS, isString, load } from "./storage";
import { Button, Spinner } from "./ui";

/**
 * Screens every game with rooms shows the same way: the breadcrumb, the
 * notices for a room that's gone or a seat that's been taken away, the form
 * to join, and leaving.
 */

/** Which game a screen belongs to, for its links. */
export interface GameName {
  name: string;
  href: string;
}

export function Crumbs({ game, code, compact = false }: { game: GameName; code?: string; compact?: boolean }) {
  const home = compact ? "hidden sm:inline" : "";
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13.5px]">
      <Link href="/" className={`text-muted transition-colors hover:text-ink ${home}`}>
        dach
      </Link>
      <span aria-hidden className={`text-faint ${home}`}>
        /
      </span>
      <Link href={game.href} className="text-muted transition-colors hover:text-ink">
        {game.name}
      </Link>
      {code && (
        <>
          <span aria-hidden className="text-faint">
            /
          </span>
          <span className="font-mono font-medium tracking-wider text-ink">{code}</span>
        </>
      )}
    </nav>
  );
}

export function Shell({ game, code, children }: { game: GameName; code?: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[40rem] px-6 py-10 text-[14px] sm:py-16">
      <Crumbs game={game} code={code} />
      <main className="mt-10">{children}</main>
    </div>
  );
}

export function Notice({ game, title, children }: { game: GameName; title: string; children: ReactNode }) {
  return (
    <Shell game={game}>
      <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted">{children}</p>
      <p className="mt-6">
        <Link href={game.href} className="font-medium underline decoration-faint underline-offset-4 hover:decoration-ink">
          back to {game.name}
        </Link>
      </p>
    </Shell>
  );
}

/** What to show instead of the room when there's no room to show, or null. */
export function RoomGone({ game, code, status }: { game: GameName; code: string; status: string }) {
  if (status === "unavailable") return <Notice game={game} title="multiplayer isn't set up here yet">whoever runs this site needs to connect a database; the readme says how.</Notice>;
  if (status === "missing") return <Notice game={game} title={`there's no room called ${code}`}>check the code, or it may have closed: rooms close a few hours after the last game.</Notice>;
  if (status === "kicked") return <Notice game={game} title="the host removed you from this room">you can make a room of your own.</Notice>;
  return null;
}

export function Connecting({ game, code }: { game: GameName; code: string }) {
  return (
    <Shell game={game} code={code}>
      <p className="text-muted">
        <Spinner className="mr-2" /> connecting to room {code}…
      </p>
    </Shell>
  );
}

interface Problems {
  error: string | null;
  offline: boolean;
}

export function ErrorLine({ snapshot, client }: { snapshot: Problems; client: { clearError(): void } }) {
  if (!snapshot.error && !snapshot.offline) return null;
  return (
    <p role="alert" className="mt-3 text-[13px] text-accent">
      {snapshot.offline ? "lost touch with the room; trying again…" : snapshot.error}{" "}
      {snapshot.error && (
        <button type="button" onClick={() => client.clearError()} className="text-muted underline underline-offset-2 hover:text-ink">
          ok
        </button>
      )}
    </p>
  );
}

/** "leave room", then "sure?", so a stray click doesn't cost you your seat. */
export function Leave({ game, client, label = "leave room" }: { game: GameName; client: { leave(): Promise<void> }; label?: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button tone="quiet" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-[13px] text-muted">leave?</span>
      <Button onClick={() => setAsking(false)}>stay</Button>
      <Link
        href={game.href}
        onClick={() => void client.leave()}
        className="inline-flex min-h-9 items-center rounded-lg bg-ink px-3.5 text-[13.5px] font-medium text-paper hover:bg-ink/85"
      >
        leave
      </Link>
    </span>
  );
}

export function JoinForm({
  game,
  code,
  players,
  note,
  snapshot,
  client,
}: {
  game: GameName;
  code: string;
  players: { name: string; active: boolean }[];
  /** A line about what's going on, like a game already under way. */
  note?: string;
  snapshot: Problems & { busy: boolean };
  client: { join(name: string): Promise<boolean>; clearError(): void };
}) {
  const [name, setName] = useState(() => load(KEYS.name, isString) ?? "");
  const here = players.filter((p) => p.active);
  const names = here.length > 5 ? `${here.slice(0, 4).map((p) => p.name).join(", ")} and ${here.length - 4} others` : here.map((p) => p.name).join(", ");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) void client.join(name.trim());
  };
  return (
    <Shell game={game} code={code}>
      <h1 className="text-[20px] font-semibold tracking-tight">join room {code}</h1>
      <p className="mt-2 text-muted">
        {here.length === 0 ? "nobody's here yet." : `${names} ${here.length === 1 ? "is" : "are"} here.`} {note}
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[12.5px] text-muted">your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            autoFocus
            autoComplete="nickname"
            className="min-h-10 rounded-lg border border-faint bg-paper px-3 text-[15px] outline-none focus:border-ink"
          />
        </label>
        <Button tone="solid" type="submit" disabled={!name.trim() || snapshot.busy} className="min-h-10">
          {snapshot.busy ? <Spinner /> : "join"}
        </Button>
      </form>
      <ErrorLine snapshot={snapshot} client={client} />
    </Shell>
  );
}

/**
 * Coming from the menu with a name typed in (it leaves `flag` set to the
 * code in session storage), take a seat without asking for the name again.
 */
export function useAutoJoin(flag: string, code: string, snapshot: { status: string; me: string | null }, client: { join(name: string): Promise<boolean> }) {
  const tried = useRef(false);
  const ready = snapshot.status === "ready";
  const me = snapshot.me;
  useEffect(() => {
    if (tried.current || !ready) return;
    tried.current = true;
    let flagged = false;
    try {
      flagged = window.sessionStorage.getItem(flag) === code;
      window.sessionStorage.removeItem(flag);
    } catch {
      // No session storage: you'll be asked for your name instead.
    }
    const name = load(KEYS.name, isString);
    // With a seat from before, the client takes it back by itself.
    if (flagged && name && me === null) void client.join(name);
  }, [ready, flag, code, client, me]);
}
