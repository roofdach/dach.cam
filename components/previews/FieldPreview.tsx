"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useOnScreen } from "@/lib/hooks";
import {
  createState,
  DEFAULT_SETTINGS,
  drawField,
  readPalette,
  type FieldSettings,
  type GlyphSetId,
} from "@/lib/field/sim";

/** The three ramps that still read at preview size. */
const SHOWN: GlyphSetId[] = ["ascii", "braille", "blocks"];

export function FieldPreview() {
  const reduce = useReducedMotion();
  const { ref: screenRef, visible } = useOnScreen<HTMLDivElement>("80px");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [glyphs, setGlyphs] = useState<GlyphSetId>("ascii");
  const [invert, setInvert] = useState(false);

  const state = useRef(createState());
  const settings = useRef<FieldSettings>({ ...DEFAULT_SETTINGS });
  const needsDraw = useRef(true);

  useEffect(() => {
    settings.current = { ...settings.current, glyphs, invert };
    needsDraw.current = true;
  }, [glyphs, invert]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;

    let frame = 0;
    let last = performance.now();
    needsDraw.current = true;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduce) {
        state.current.time += dt;
        drawField(canvas, settings.current, state.current, readPalette(canvas));
      } else if (needsDraw.current) {
        drawField(canvas, settings.current, state.current, readPalette(canvas));
        needsDraw.current = false;
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [visible, reduce]);

  const toCell = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / settings.current.cell, y: (event.clientY - rect.top) / settings.current.cell };
  };

  return (
    <div ref={screenRef} className="relative h-full min-h-[18rem] w-full overflow-hidden @md:min-h-[26rem]">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="An interactive field of characters that ripples as you move over it"
        tabIndex={0}
        className="block h-full w-full cursor-crosshair touch-none outline-none"
        onPointerMove={(e) => {
          state.current.pointer = toCell(e);
          needsDraw.current = true;
        }}
        onPointerLeave={() => {
          state.current.pointer = null;
          needsDraw.current = true;
        }}
        onPointerDown={(e) => {
          state.current.ripples.push({ ...toCell(e), t0: state.current.time });
          needsDraw.current = true;
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const cell = settings.current.cell;
          state.current.ripples.push({ x: rect.width / cell / 2, y: rect.height / cell / 2, t0: state.current.time });
          needsDraw.current = true;
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-paper-2 to-transparent" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 p-4 text-[11px]">
        <div
          role="group"
          aria-label="Glyph set"
          className="pointer-events-auto flex rounded-full border border-line bg-paper/80 p-0.5 backdrop-blur-sm"
        >
          {SHOWN.map((g) => (
            <button
              key={g}
              aria-pressed={glyphs === g}
              onClick={() => {
                setGlyphs(g);
                needsDraw.current = true;
              }}
              className={`rounded-full px-2.5 py-0.5 font-mono transition-colors ${
                glyphs === g ? "bg-ink text-paper" : "text-muted hover:text-ink"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
        <button
          aria-pressed={invert}
          onClick={() => {
            setInvert((v) => !v);
            needsDraw.current = true;
          }}
          className={`pointer-events-auto rounded-full border border-line px-2.5 py-0.5 font-mono backdrop-blur-sm transition-colors ${
            invert ? "bg-ink text-paper" : "bg-paper/80 text-muted hover:text-ink"
          }`}
        >
          invert
        </button>
      </div>
    </div>
  );
}
