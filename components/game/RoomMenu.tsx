"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { CODE_LENGTH, NOT_CODE_LETTERS } from "@/lib/rooms/codes";
import type { GameName } from "./room-ui";
import { KEYS, isString, load, save } from "./storage";
import { Button, Spinner, plural } from "./ui";

/**
 * A room game's front page: your name, then a room code to join (typing the
 * last letter goes straight there), or a room of your own.
 */
export function RoomMenu({
  game,
  api,
  seat,
  joinFlag,
  multiplayer,
  intro,
  how,
  createHint,
}: {
  game: GameName;
  /** Where rooms are made and looked up, like /api/draw/rooms. */
  api: string;
  /** Where your seat in a room is remembered. */
  seat: (code: string) => string;
  /** See useAutoJoin. */
  joinFlag: string;
  multiplayer: boolean;
  intro: ReactNode;
  how: ReactNode;
  createHint: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(() => load(KEYS.name, isString) ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"join" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const problem = (e: unknown) => (e instanceof TypeError ? "couldn't reach the server; check your connection" : (e as Error).message);

  const join = async (value: string) => {
    if (value.length !== CODE_LENGTH || busy) return;
    setBusy("join");
    setError(null);
    try {
      // Check there's such a room first, so a typo is caught here rather than on a page of its own.
      const response = await fetch(`${api}/${value}`, { headers: { Accept: "application/json" } });
      if (response.status === 404) throw new Error(`there's no room called ${value}. check the code?`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "couldn't reach that room");
      }
      const trimmed = name.trim();
      if (trimmed) {
        save(KEYS.name, trimmed);
        try {
          window.sessionStorage.setItem(joinFlag, value);
        } catch {
          // You'll be asked for your name there instead.
        }
      }
      router.push(`${game.href}/${value}`);
    } catch (e) {
      setError(problem(e));
      setBusy(null);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("put your name in first");
      nameInput.current?.focus();
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const response = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; you?: { id: string; token: string }; room?: { code: string } } | null;
      if (!response.ok || !body?.you || !body.room) throw new Error(body?.error ?? "couldn't make a room");
      save(KEYS.name, trimmed);
      save(seat(body.room.code), body.you);
      router.push(`${game.href}/${body.room.code}`);
    } catch (e) {
      setError(problem(e));
      setBusy(null);
    }
  };

  const typeCode = (raw: string) => {
    const next = raw.toUpperCase().replace(NOT_CODE_LETTERS, "").slice(0, CODE_LENGTH);
    setCode(next);
    setError(null);
    // The last letter in goes straight to the room.
    if (next.length === CODE_LENGTH && next !== code) void join(next);
  };

  return (
    <div className="mx-auto w-full max-w-[40rem] px-6 py-10 text-[14px] sm:py-16">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13.5px]">
        <Link href="/" className="text-muted transition-colors hover:text-ink">
          dach
        </Link>
        <span aria-hidden className="text-faint">
          /
        </span>
        <span className="font-medium text-ink">{game.name}</span>
      </nav>

      <main className="mt-10">
        <h1 className="text-[28px] font-semibold tracking-tight">{game.name}</h1>
        <p className="mt-2 text-muted">{intro}</p>

        {!multiplayer ? (
          <div role="alert" className="mt-8 rounded-lg border border-accent/40 bg-accent/5 p-4 text-[13.5px]">
            <p className="font-medium text-accent">multiplayer isn&rsquo;t set up on this site yet.</p>
            <p className="mt-1 text-muted">it needs a small free database, and the readme says how.</p>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            <label className="flex max-w-[20rem] flex-col gap-1.5">
              <span className="text-[12.5px] text-muted">your name</span>
              <input
                ref={nameInput}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                maxLength={16}
                autoComplete="nickname"
                className="min-h-10 rounded-lg border border-faint bg-paper px-3 text-[15px] outline-none focus:border-ink"
              />
            </label>

            <section aria-labelledby="join">
              <h2 id="join" className="text-muted">
                join a room
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void join(code);
                }}
                className="mt-3 flex flex-wrap items-center gap-2"
              >
                <input
                  value={code}
                  onChange={(e) => typeCode(e.target.value)}
                  placeholder="CODE"
                  aria-label="room code"
                  aria-describedby="code-hint"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-h-14 w-[11.5rem] rounded-lg border border-faint bg-paper px-4 font-mono text-[28px] font-semibold tracking-[0.3em] uppercase outline-none placeholder:text-faint focus:border-ink"
                />
                <Button type="submit" tone="solid" disabled={code.length !== CODE_LENGTH || busy !== null} className="min-h-14 px-5">
                  {busy === "join" ? <Spinner /> : "join"}
                </Button>
              </form>
              <p id="code-hint" className="mt-2 text-[12.5px] text-muted">
                codes are {plural(CODE_LENGTH, "letter")}, no vowels. no link needed: the host reads it out.
              </p>
            </section>

            <section aria-labelledby="create">
              <h2 id="create" className="text-muted">
                or start one
              </h2>
              <form onSubmit={create} className="mt-3 flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy !== null} className="min-h-10 px-5">
                  {busy === "create" ? <Spinner /> : "make a room"}
                </Button>
                <span className="text-[12.5px] text-muted">{createHint}</span>
              </form>
            </section>

            {error && (
              <p role="alert" className="text-[13px] text-accent">
                {error}
              </p>
            )}
          </div>
        )}

        <section aria-labelledby="how" className="mt-12 text-[13px] text-muted">
          <h2 id="how" className="text-ink">
            how it works
          </h2>
          <p className="mt-2">{how}</p>
        </section>
      </main>
    </div>
  );
}
