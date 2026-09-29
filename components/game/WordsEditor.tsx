"use client";

import { useState } from "react";
import { plural } from "./ui";

/** Words typed with commas or on lines of their own. */
const splitWords = (text: string) =>
  text
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);

/**
 * Where a host types words of their own for a word game, and says whether
 * to play with only those. Saved when the box loses focus.
 */
export function WordsEditor({
  words,
  only,
  max,
  disabled,
  onChange,
}: {
  words: string[];
  only: boolean;
  max: number;
  disabled: boolean;
  onChange: (patch: { words?: string[]; only?: boolean }) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? words.join(", ");
  const typed = splitWords(shown);
  const save = () => {
    if (text === null) return;
    const list = splitWords(text).slice(0, max);
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
        className="rounded-lg border border-faint bg-paper px-3 py-2 text-[16px] leading-snug outline-none placeholder:text-faint focus:border-ink disabled:opacity-60 sm:text-[14px]"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
        <span>
          {plural(typed.length, "word")}
          {typed.length > max && `; only the first ${max} count`}
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
