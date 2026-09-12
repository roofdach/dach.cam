"use client";

import { useMemo, useState } from "react";
import { parseColor, toHex } from "@/lib/color";
import { buildScale, DEFAULT_SCALE_OPTIONS, serialise } from "@/lib/palette/scale";

const SUGGESTIONS = ["#b7502f", "#3b6ea5", "#5b8a72", "#8a5c7d", "#c9a227"];

export function PalettePreview() {
  const [input, setInput] = useState("#b7502f");
  const parsed = useMemo(() => parseColor(input), [input]);
  const scale = useMemo(() => (parsed ? buildScale(parsed, DEFAULT_SCALE_OPTIONS) : null), [parsed]);

  return (
    <div className="flex h-full flex-col gap-5 p-5 text-ink @md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="size-7 shrink-0 rounded-md border border-line"
            style={{ backgroundColor: parsed ? toHex(parsed) : "transparent" }}
            aria-hidden
          />
          <label htmlFor="palette-preview-input" className="sr-only">
            Colour
          </label>
          <input
            id="palette-preview-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="w-[8.5rem] rounded-md border border-line bg-paper px-2.5 py-1 font-mono text-[12.5px] text-ink outline-none"
          />
        </div>
        <ul className="flex items-center gap-1.5" aria-label="Suggestions">
          {SUGGESTIONS.map((hex) => (
            <li key={hex}>
              <button
                onClick={() => setInput(hex)}
                aria-label={`Use ${hex}`}
                className="size-5 rounded-full border border-line transition-transform hover:scale-110"
                style={{ backgroundColor: hex }}
              />
            </li>
          ))}
        </ul>
      </div>

      {scale ? (
        <>
          <ul className="flex h-24 overflow-hidden rounded-lg border border-line @md:h-32">
            {scale.swatches.map((swatch) => (
              <li
                key={swatch.step}
                title={`${swatch.step} · ${swatch.hex}`}
                className="flex flex-1 items-end justify-center pb-1.5"
                style={{ backgroundColor: swatch.hex, color: swatch.ink }}
              >
                <span className="font-mono text-[9.5px] opacity-70 tnum">{swatch.step}</span>
              </li>
            ))}
          </ul>

          <pre className="min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-paper p-3 font-mono text-[10.5px] leading-relaxed text-muted">
            {serialise(scale, "tailwind").split("\n").slice(0, 7).join("\n")}
            {"\n  …"}
          </pre>
        </>
      ) : (
        <p className="text-[13px] text-accent">couldn&rsquo;t read that as a colour.</p>
      )}
    </div>
  );
}
