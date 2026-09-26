"use client";

import { useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";

/* ------------------------------------------------------------ buttons */

type Tone = "solid" | "outline" | "quiet";

const TONES: Record<Tone, string> = {
  solid: "bg-ink text-paper hover:bg-ink/85 disabled:bg-ink/30 disabled:text-paper/80",
  outline: "border border-faint/80 text-ink hover:border-ink/40 hover:bg-ink/[0.04] disabled:text-muted",
  quiet: "text-muted hover:text-ink disabled:opacity-50",
};

export function Button({
  tone = "outline",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}

/** A floating control over Street View: legible on any sky. */
export function Float({ className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-paper/92 px-3 py-1.5 text-[13px] font-medium text-ink shadow-[0_1px_6px_rgb(0_0_0/0.25)] backdrop-blur transition-colors hover:bg-paper disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}

/** One of a row of choices. */
export function Choice({
  selected,
  onSelect,
  children,
  disabled,
  title,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      disabled={disabled}
      title={title}
      className="rounded-lg border border-faint/70 px-2.5 py-1 text-[13px] text-muted transition-colors hover:border-ink/35 hover:text-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-faint/70 disabled:hover:text-muted"
    >
      {children}
    </button>
  );
}

export function Spinner({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent align-[-3px] ${className}`}
    />
  );
}

/* --------------------------------------------------------------- media */

const subscribers = new Map<string, (onChange: () => void) => () => void>();

/** One subscribe function per query, so React doesn't resubscribe on every render. */
function subscribeQuery(query: string) {
  let subscribe = subscribers.get(query);
  if (!subscribe) {
    subscribe = (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    };
    subscribers.set(query, subscribe);
  }
  return subscribe;
}

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    subscribeQuery(query),
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}

/** A mouse and room for a corner map, as on a laptop; otherwise the map gets its own screen. */
export const DESKTOP = "(hover: hover) and (pointer: fine) and (min-width: 700px) and (min-height: 480px)";

/* ------------------------------------------------------------- numbers */

/** "1:05" for sixty-five seconds, rounding up so 0:00 means time's up. */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "5h 12m", "12m", "40s". */
export function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes > 1) return `${minutes}m`;
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
}

/** First letters of up to two words, for a map pin. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]].map((w) => Array.from(w)[0]) : Array.from(words[0] ?? "?").slice(0, 1);
  return letters.join("").toUpperCase() || "?";
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
