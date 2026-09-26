"use client";

import Link from "next/link";
import { useId, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { BY_CODE, arrow, findCountry, flagUrl, suggest, type Country, type Hint } from "@/lib/shape/game";
import { Button } from "@/components/game/ui";

/** A country's outline, filled, as big as its box allows. */
export function Outline({ shape, className = "", label = "the country's outline" }: { shape: { path: string; w: number; h: number }; className?: string; label?: string }) {
  const pad = Math.max(shape.w, shape.h) * 0.04;
  return (
    <svg viewBox={`${-pad} ${-pad} ${shape.w + 2 * pad} ${shape.h + 2 * pad}`} role="img" aria-label={label} className={`block ${className}`}>
      <path d={shape.path} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/**
 * A country's flag, as decoration: it's always next to the country's name,
 * except in the quiz's flag question, where naming it would give it away.
 */
export function Flag({ code, className = "h-4" }: { code: string; className?: string }) {
  if (!BY_CODE.get(code)?.flag) return null;
  // eslint-disable-next-line @next/next/no-img-element -- small static svgs, no need for next/image
  return <img src={flagUrl(code)} alt="" className={`inline-block aspect-[3/2] rounded-[2px] shadow-[0_0_0_1px_rgb(0_0_0/0.12)] ${className}`} />;
}

/**
 * Where you type a country: suggestions as you go, arrow keys to move
 * between them, Enter to take the highlighted one.
 */
export function CountryInput({
  onGuess,
  exclude = new Set<string>(),
  disabled = false,
  placeholder = "type a country…",
  action = "guess",
}: {
  onGuess: (country: Country) => void;
  exclude?: ReadonlySet<string>;
  disabled?: boolean;
  placeholder?: string;
  action?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const options = useMemo(() => suggest(text, 6, exclude), [text, exclude]);

  const choose = (country: Country) => {
    onGuess(country);
    setText("");
    setActive(0);
    setProblem(null);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (disabled) return;
    const exact = findCountry(text);
    if (exact && exclude.has(exact.code)) return setProblem(`you've already said ${exact.name}`);
    const pick = exact ?? options[Math.min(active, options.length - 1)];
    if (pick) return choose(pick);
    setProblem(text.trim() ? "that's not a country i know" : null);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      setActive((a) => (a + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (event.key === "Escape") {
      setText("");
    }
  };

  const open = options.length > 0 && text.trim().length > 0;
  return (
    <form onSubmit={submit} className="relative w-full">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setProblem(null);
          }}
          onKeyDown={onKey}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          role="combobox"
          aria-label="country"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open ? `${id}-${active}` : undefined}
          // 16px on phones, or iPhones zoom in when it's tapped.
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-faint bg-paper px-3 text-[16px] outline-none placeholder:text-faint focus:border-ink disabled:opacity-60 sm:text-[15px]"
        />
        <Button tone="solid" type="submit" disabled={disabled || !text.trim()} className="min-h-11 px-5">
          {action}
        </Button>
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-faint bg-paper shadow-lg">
          {options.map((country, i) => (
            <li
              key={country.code}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(country)}
              onMouseEnter={() => setActive(i)}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[15px] aria-selected:bg-ink/[0.07]"
            >
              <Flag code={country.code} className="h-3.5" />
              {country.name}
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p role="alert" className="mt-1.5 text-[13px] text-accent">
          {problem}
        </p>
      )}
    </form>
  );
}

const km = new Intl.NumberFormat("en-GB");

/** One guess and how near it was: the country, the distance, which way to go, and how close as a share. */
export function HintRow({ hint }: { hint: Hint }) {
  const country = BY_CODE.get(hint.code)!;
  const right = hint.proximity === 100;
  return (
    <li className={`grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 rounded-lg px-3 py-2 text-[14px] ${right ? "bg-[#d3f9d8] text-[#2b8a3e] dark:bg-[#1f3d25] dark:text-[#8ce99a]" : "bg-ink/[0.045]"}`}>
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <Flag code={hint.code} className="h-3.5 shrink-0" />
        <span className="truncate">{country.name}</span>
      </span>
      <span className="text-right font-mono tabular-nums text-[13px]">{right ? "" : `${km.format(hint.km)} km`}</span>
      <span className="w-5 text-center text-[17px] leading-none" aria-label={right ? "that's it" : `the answer is ${["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][hint.direction]}`}>
        {arrow(hint)}
      </span>
      <span className="w-10 text-right font-mono tabular-nums text-[13px]">{hint.proximity}%</span>
    </li>
  );
}

/** Guesses so far, with empty rows for the ones left. */
export function Hints({ hints, total }: { hints: readonly Hint[]; total: number }) {
  return (
    <ol className="space-y-1.5">
      {hints.map((hint) => (
        <HintRow key={hint.code} hint={hint} />
      ))}
      {Array.from({ length: Math.max(0, total - hints.length) }, (_, i) => (
        <li key={`empty-${i}`} aria-hidden className="h-[38px] rounded-lg border border-dashed border-faint/70" />
      ))}
    </ol>
  );
}

/** A solo mode's page: breadcrumb, then the game, centred. */
export function Frame({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[34rem] px-4 pb-16 pt-6 text-[14px] sm:px-6 sm:pt-10">
      <div className="flex items-center gap-2 text-[13.5px]">
        <Link href="/" className="text-muted transition-colors hover:text-ink">
          dach
        </Link>
        <span aria-hidden className="text-faint">
          /
        </span>
        <Link href="/shape" className="text-muted transition-colors hover:text-ink">
          shape
        </Link>
        <span aria-hidden className="text-faint">
          /
        </span>
        <span className="font-medium text-ink">{title}</span>
        <span className="flex-1" />
        {right}
      </div>
      <main className="mt-6">{children}</main>
    </div>
  );
}

/** Copies text to share, with a word of thanks, or a box to copy from if the clipboard's off limits. */
export function ShareButton({ text, label = "share" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  };
  return (
    <Button tone="solid" onClick={() => void share()} className="min-h-10 px-5">
      {copied ? "copied!" : label}
    </Button>
  );
}
