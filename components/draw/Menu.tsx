"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { CODE_LENGTH, NOT_CODE_LETTERS } from "@/lib/rooms/codes";
import { KEYS, isString, load, save } from "@/components/game/storage";
import { Button, Spinner, plural } from "@/components/game/ui";
import { JOIN_FLAG } from "./Room";

/** The front page: your name, then a room code to join, or a room of your own. */
export function Menu({ multiplayer }: { multiplayer: boolean }) {
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
      const response = await fetch(`/api/draw/rooms/${value}`, { headers: { Accept: "application/json" } });
      if (response.status === 404) throw new Error(`there's no room called ${value}. check the code?`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "couldn't reach that room");
      }
      const trimmed = name.trim();
      if (trimmed) {
        save(KEYS.name, trimmed);
        try {
          window.sessionStorage.setItem(JOIN_FLAG, value);
        } catch {
          // You'll be asked for your name there instead.
        }
      }
      router.push(`/draw/${value}`);
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
      const response = await fetch("/api/draw/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; you?: { id: string; token: string }; room?: { code: string } } | null;
      if (!response.ok || !body?.you || !body.room) throw new Error(body?.error ?? "couldn't make a room");
      save(KEYS.name, trimmed);
      save(KEYS.drawRoom(body.room.code), body.you);
      router.push(`/draw/${body.room.code}`);
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
        <span className="font-medium text-ink">draw</span>
      </nav>

      <main className="mt-10">
        <h1 className="text-[28px] font-semibold tracking-tight">draw</h1>
        <p className="mt-2 text-muted">
          one of you draws a word, everyone else races to guess it in the chat. the quicker you guess, the more you score. everyone
          gets a turn to draw, for two to twelve players.
        </p>

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
                <span className="text-[12.5px] text-muted">you&rsquo;ll get a code for your friends, and you pick the rounds and time.</span>
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
          <p className="mt-2">
            each turn the drawer picks one of three words and has a minute or two to draw it, with a pen, a paint bucket and 24 colours.
            everyone else types guesses; a guess that&rsquo;s one letter off gets a nudge, and letters appear as hints as time runs
            down. the drawer scores for every person who gets it. the host can add their own words, like names everyone in the room
            knows.
          </p>
        </section>
      </main>
    </div>
  );
}
