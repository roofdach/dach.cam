"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { accentApplied, applyAccent, noAccentApplied, subscribeAccent, type Accent } from "@/lib/accent";
import { useCopy } from "@/lib/hooks";
import { parseColor, toHex } from "@/lib/color";
import {
  buildScale,
  DEFAULT_SCALE_OPTIONS,
  FORMATS,
  serialise,
  type Format,
  type Swatch,
} from "@/lib/palette/scale";
import { CheckIcon, CopyIcon } from "../Icons";

const SUGGESTIONS = ["#b7502f", "#3b6ea5", "#5b8a72", "#8a5c7d", "#c9a227"];

function CopyButton({ value, label = "copy" }: { value: string; label?: string }) {
  const reduce = useReducedMotion();
  const { copied, copy } = useCopy();
  return (
    <button
      onClick={() => copy(value)}
      className="inline-flex items-center gap-1.5 text-[11.5px] text-muted transition-colors hover:text-ink"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? "copied" : "copy"}
          initial={reduce ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.15 }}
          className="inline-flex items-center gap-1.5"
        >
          {copied ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />}
          {copied ? "copied" : label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function Swatches({ swatches, onPick }: { swatches: Swatch[]; onPick: (hex: string) => void }) {
  return (
    <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-11 sm:gap-0">
      {swatches.map((swatch) => (
        <li key={swatch.step} className="relative">
          <button
            onClick={() => onPick(swatch.hex)}
            title={`${swatch.step} · ${swatch.hex}`}
            className="flex h-16 w-full flex-row items-center justify-between gap-3 px-4 text-left transition-transform sm:h-44 sm:flex-col sm:items-start sm:justify-end sm:px-0 sm:py-3"
            style={{ backgroundColor: swatch.hex, color: swatch.ink }}
          >
            <span className="font-mono text-[11.5px] opacity-80 sm:px-2.5 tnum">{swatch.step}</span>
            <span className="font-mono text-[11px] opacity-70 sm:px-2.5">{swatch.hex.slice(1)}</span>
            {swatch.anchor && (
              <span
                className="absolute right-3 top-3 rounded-full px-1.5 py-px text-[10px] font-medium sm:right-auto sm:left-2 sm:top-2"
                style={{ backgroundColor: swatch.ink, color: swatch.hex }}
              >
                yours
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Palette() {
  const id = useId();
  const [input, setInput] = useState("#b7502f");
  const [name, setName] = useState(DEFAULT_SCALE_OPTIONS.name);
  const [keepInput, setKeepInput] = useState(true);
  const [format, setFormat] = useState<Format>("tailwind");

  const parsed = useMemo(() => parseColor(input), [input]);
  const scale = useMemo(
    () => (parsed ? buildScale(parsed, { keepInput, name: name.replace(/[^\w-]/g, "").toLowerCase() || "brand" }) : null),
    [parsed, keepInput, name],
  );
  const output = useMemo(() => (scale ? serialise(scale, format) : ""), [scale, format]);
  const clipped = scale?.swatches.filter((s) => s.clipped) ?? [];

  /** 600 carries a light page, 400 holds up against a dark one. */
  const accent: Accent | null = useMemo(() => {
    if (!scale) return null;
    const step = (n: number) => scale.swatches.find((sw) => sw.step === n)!.hex;
    return { light: step(600), dark: step(400) };
  }, [scale]);

  const applied = useSyncExternalStore(subscribeAccent, accentApplied, noAccentApplied);

  // The rest of the site reads these two variables, so choosing here recolours
  // everything, including this page.
  useEffect(() => {
    if (!accent || !applied) return;
    applyAccent(accent);
  }, [accent, applied]);

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end gap-x-8 gap-y-5">
        <div>
          <label htmlFor={`${id}-colour`} className="label mb-2 block">
            your colour
          </label>
          <div className="flex items-center gap-2.5">
            <span
              className="size-9 shrink-0 rounded-lg border border-line"
              style={{ backgroundColor: parsed ? toHex(parsed) : "transparent" }}
              aria-hidden
            />
            <input
              id={`${id}-colour`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="#b7502f"
              spellCheck={false}
              autoComplete="off"
              className="w-[12rem] rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-faint"
            />
            <label className="sr-only" htmlFor={`${id}-picker`}>
              Pick a colour
            </label>
            <input
              id={`${id}-picker`}
              type="color"
              value={parsed ? toHex(parsed) : "#b7502f"}
              onChange={(e) => setInput(e.target.value)}
              className="size-9 cursor-pointer rounded-lg border border-line bg-paper p-1"
            />
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-name`} className="label mb-2 block">
            name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="brand"
            spellCheck={false}
            className="w-[9rem] rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </div>

        <label className="flex items-center gap-2 pb-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={keepInput}
            onChange={(e) => setKeepInput(e.target.checked)}
            className="accent-(--accent)"
          />
          keep my colour exactly
        </label>

        <ul className="flex items-center gap-1.5 pb-1.5" aria-label="Suggestions">
          {SUGGESTIONS.map((hex) => (
            <li key={hex}>
              <button
                onClick={() => setInput(hex)}
                title={hex}
                aria-label={`Use ${hex}`}
                className="size-6 rounded-full border border-line transition-transform hover:scale-110"
                style={{ backgroundColor: hex }}
              />
            </li>
          ))}
        </ul>
      </section>

      {!parsed || !scale ? (
        <p className="text-[14px] text-accent">
          couldn&rsquo;t read that as a colour. try #hex, rgb(), hsl(), oklch() or a plain name like &ldquo;teal&rdquo;.
        </p>
      ) : (
        <>
          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 className="label">the scale</h2>
              <p className="text-[12.5px] text-muted">
                your colour sits at {scale.anchorStep}. click any step to build from that one instead.
              </p>
            </div>
            <Swatches swatches={scale.swatches} onPick={setInput} />
          </section>

          <section className="grid gap-8 lg:grid-cols-[1fr_22rem]">
            <div>
              <h2 className="label mb-3">contrast</h2>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th scope="col" className="pb-2 font-normal">
                      step
                    </th>
                    <th scope="col" className="pb-2 font-normal">
                      on white
                    </th>
                    <th scope="col" className="pb-2 font-normal">
                      on black
                    </th>
                    <th scope="col" className="pb-2 font-normal">
                      readable text
                    </th>
                    <th scope="col" className="pb-2 font-normal">
                      grade
                    </th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {scale.swatches.map((swatch) => (
                    <tr key={swatch.step} className="border-t border-line">
                      <th scope="row" className="py-1.5 text-left font-normal text-ink">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block size-3 rounded-[3px] border border-line"
                            style={{ backgroundColor: swatch.hex }}
                          />
                          {swatch.step}
                        </span>
                      </th>
                      <td className="py-1.5 text-ink-2">{swatch.contrast.white.toFixed(2)}</td>
                      <td className="py-1.5 text-ink-2">{swatch.contrast.black.toFixed(2)}</td>
                      <td className="py-1.5 text-ink-2">{swatch.ink}</td>
                      <td className={`py-1.5 ${swatch.grade === "fails" ? "text-accent" : "text-ink-2"}`}>
                        {swatch.grade}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                the ratio is against plain white and plain black. a step graded for large text only is fine for a
                heading and not for body copy.
              </p>
            </div>

            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="label">copy it out</h2>
                <CopyButton value={output} />
              </div>
              <div role="tablist" aria-label="Format" className="mb-3 flex flex-wrap gap-1 text-[12.5px]">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    role="tab"
                    aria-selected={format === f.id}
                    onClick={() => setFormat(f.id)}
                    className={`rounded-full border px-2.5 py-1 transition-colors ${
                      format === f.id
                        ? "border-ink bg-ink text-paper"
                        : "border-line text-muted hover:border-faint hover:text-ink"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <pre className="overflow-x-auto rounded-lg border border-line bg-paper-2 p-4 font-mono text-[11.5px] leading-relaxed text-ink-2 scrollbar-none">
                {output}
              </pre>
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-paper-2 px-4 py-3 text-[13px]">
            <label className="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={applied}
                onChange={(e) => applyAccent(e.target.checked ? accent : null)}
                className="accent-(--accent)"
              />
              use this colour across the site
            </label>
            <p className="text-muted">
              {applied
                ? "600 on a light page, 400 in the dark. it stays until you turn it off."
                : "links, underlines, charts and the text selection all follow it."}
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="label">in use</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { bg: 50, text: 900, label: "quiet surface" },
                { bg: 500, text: 50, label: "the loud one" },
                { bg: 950, text: 200, label: "dark surface" },
              ].map((combo) => {
                const bg = scale.swatches.find((s) => s.step === combo.bg)!;
                const text = scale.swatches.find((s) => s.step === combo.text)!;
                return (
                  <div
                    key={combo.label}
                    className="rounded-xl border border-line p-5"
                    style={{ backgroundColor: bg.hex, color: text.hex }}
                  >
                    <p className="font-mono text-[11px] opacity-70">
                      {combo.bg} / {combo.text}
                    </p>
                    <p className="mt-2 text-[15px] leading-snug">{combo.label}</p>
                    <p className="mt-1 text-[13px] opacity-80">
                      the quick brown fox jumps over the lazy dog, and reads fine doing it.
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {clipped.length > 0 && (
            <p className="text-[12.5px] leading-relaxed text-muted">
              {clipped.length} step{clipped.length === 1 ? " was" : "s were"} pulled back inside sRGB (
              {clipped.map((s) => s.step).join(", ")}). that hue simply cannot be that colourful at that lightness on
              an ordinary screen, so the chroma came down rather than the hue bending.
            </p>
          )}
        </>
      )}
    </div>
  );
}
