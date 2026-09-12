"use client";

import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useCopy, useElementSize } from "@/lib/hooks";
import { EXPORTS, toHtml, toReact, type ExportKind } from "@/lib/field/export";
import { fieldToSvg } from "@/lib/field/svg";
import {
  buildMask,
  createState,
  DEFAULT_SETTINGS,
  drawField,
  GLYPH_SETS,
  gridFor,
  readPalette,
  type ColorMode,
  type FieldSettings,
  type GlyphSetId,
} from "@/lib/field/sim";

const GLYPH_IDS = Object.keys(GLYPH_SETS) as GlyphSetId[];
const COLOR_MODES: ColorMode[] = ["ink", "accent", "duotone"];

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12.5px] text-ink-2">
          {label}
        </label>
        <span className="font-mono text-[11px] text-muted tnum">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="mt-1.5 w-full accent-(--accent)"
      />
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`rounded-full border px-2.5 py-1 font-mono text-[11.5px] transition-colors ${
              value === option
                ? "border-ink bg-ink text-paper"
                : "border-line text-muted hover:border-faint hover:text-ink"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field() {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { ref: frameRef, width, height } = useElementSize<HTMLDivElement>();

  const [settings, setSettings] = useState<FieldSettings>({ ...DEFAULT_SETTINGS, cell: 14 });
  const [stencil, setStencil] = useState("");
  const [running, setRunning] = useState(true);
  const [exported, setExported] = useState<{ kind: ExportKind; code: string } | null>(null);
  const { copied, copy } = useCopy();

  const state = useRef(createState());
  const live = useRef(settings);
  const needsDraw = useRef(true);

  // One loop for the life of the canvas. Settings are read through a ref so
  // changing a slider never restarts it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const moving = running && !reduce;
      if (moving) state.current.time += dt * live.current.speed;
      if (moving || needsDraw.current) {
        drawField(canvas, live.current, state.current, readPalette(canvas));
        needsDraw.current = false;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [running, reduce]);

  // The loop reads settings through a ref, so a slider never restarts it.
  useEffect(() => {
    live.current = settings;
    needsDraw.current = true;
  }, [settings, width, height]);

  // The stencil is rasterised at grid resolution, so it is rebuilt when the
  // grid changes shape as well as when the text changes.
  useEffect(() => {
    if (!width || !height) return;
    const { cols, rows } = gridFor(width, height, settings.cell);
    const font = canvasRef.current ? getComputedStyle(canvasRef.current).getPropertyValue("--font-geist-sans").trim() : "";
    state.current.mask = buildMask(stencil, cols, rows, font || "sans-serif");
    needsDraw.current = true;
  }, [stencil, width, height, settings.cell]);

  const toCell = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / settings.cell, y: (event.clientY - rect.top) / settings.cell };
  };

  const ripple = useCallback((x: number, y: number) => {
    state.current.ripples.push({ x, y, t0: state.current.time });
    needsDraw.current = true;
  }, []);

  const download = useCallback((filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  /** Colours are baked into an export, since the target project won't have these variables. */
  const paletteHex = useCallback(() => {
    const canvas = canvasRef.current;
    const styles = canvas ? getComputedStyle(canvas) : null;
    const read = (name: string, fallback: string) => styles?.getPropertyValue(name).trim() || fallback;
    return { ink: read("--ink", "#1b1a17"), accent: read("--accent", "#b7502f"), paper: read("--paper", "#f6f4ee") };
  }, []);

  const buildExport = useCallback(
    (kind: ExportKind) => {
      const palette = paletteHex();
      if (kind === "svg") {
        setExported({
          kind,
          code: fieldToSvg({
            width: Math.max(320, Math.round(width)),
            height: Math.max(240, Math.round(height)),
            settings,
            state: state.current,
            palette,
          }),
        });
        return;
      }
      const options = { settings, stencil, ...palette };
      setExported({ kind, code: kind === "react" ? toReact(options) : toHtml(options) });
    },
    [height, paletteHex, settings, stencil, width],
  );

  const exportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The live canvas is transparent, so flatten it onto the page colour first.
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--paper").trim() || "#f6f4ee";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    out.toBlob((blob) => {
      if (blob) download(`field-${Date.now()}.png`, blob);
    }, "image/png");
  }, [download]);

  const { cols, rows } = gridFor(width || 0, height || 0, settings.cell);
  const set = <K extends keyof FieldSettings>(key: K, value: FieldSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_15rem] lg:gap-8">
      <div
        ref={frameRef}
        className="relative min-h-[24rem] overflow-hidden rounded-xl border border-line bg-paper-2 lg:min-h-[34rem] lg:h-[calc(100vh-20rem)]"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="A grid of characters whose brightness moves in waves. Moving the pointer pushes the wave, clicking drops a ripple."
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
            const cell = toCell(e);
            ripple(cell.x, cell.y);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              ripple(cols / 2, rows / 2);
            }
          }}
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-paper-2 to-transparent p-4 font-mono text-[11px] text-muted">
          <span className="tnum">
            {cols}×{rows} · {cols * rows} glyphs
          </span>
          <span className="hidden sm:block">click to drop a ripple</span>
        </div>
      </div>

      <div className="space-y-6 lg:sticky lg:top-8 lg:self-start">
        <Segmented label="glyph ramp" options={GLYPH_IDS} value={settings.glyphs} onChange={(v) => set("glyphs", v)} />
        <Segmented label="colour" options={COLOR_MODES} value={settings.color} onChange={(v) => set("color", v)} />

        <div className="space-y-4 border-t border-line pt-5">
          <Slider
            label="density"
            min={7}
            max={34}
            step={1}
            value={settings.cell}
            format={(v) => `${v}px`}
            onChange={(v) => set("cell", v)}
          />
          <Slider label="speed" min={0} max={3} step={0.05} value={settings.speed} format={(v) => v.toFixed(2)} onChange={(v) => set("speed", v)} />
          <Slider
            label="amplitude"
            min={0}
            max={2}
            step={0.05}
            value={settings.amplitude}
            format={(v) => v.toFixed(2)}
            onChange={(v) => set("amplitude", v)}
          />
          <Slider label="weave" min={0.2} max={3} step={0.05} value={settings.scale} format={(v) => v.toFixed(2)} onChange={(v) => set("scale", v)} />
          <Slider
            label="pointer"
            min={1}
            max={26}
            step={1}
            value={settings.pointerRadius}
            format={(v) => `${v} cells`}
            onChange={(v) => set("pointerRadius", v)}
          />
        </div>

        <div className="space-y-3 border-t border-line pt-5">
          <label htmlFor="field-stencil" className="label block">
            stencil
          </label>
          <input
            id="field-stencil"
            value={stencil}
            onChange={(e) => setStencil(e.target.value)}
            placeholder="type a word"
            spellCheck={false}
            className="w-full rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint"
          />
          {stencil && (
            <Slider
              label="stencil weight"
              min={0}
              max={2}
              step={0.05}
              value={settings.maskStrength}
              format={(v) => v.toFixed(2)}
              onChange={(v) => set("maskStrength", v)}
            />
          )}
          <p className="text-[11.5px] leading-relaxed text-muted">
            the word is drawn once at grid resolution and its alpha is added to the wave, so the letters are made of
            the same glyphs as everything else.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line pt-5 text-[12px]">
          <button
            onClick={() => setRunning((r) => !r)}
            aria-pressed={!running}
            className="rounded-full border border-line px-3 py-1 text-muted transition-colors hover:border-faint hover:text-ink"
          >
            {running ? "pause" : "play"}
          </button>
          <button
            onClick={() => set("invert", !settings.invert)}
            aria-pressed={settings.invert}
            className={`rounded-full border px-3 py-1 transition-colors ${
              settings.invert ? "border-ink bg-ink text-paper" : "border-line text-muted hover:border-faint hover:text-ink"
            }`}
          >
            invert
          </button>
          <button
            onClick={() => {
              setSettings({ ...DEFAULT_SETTINGS, cell: 14 });
              setStencil("");
              state.current.ripples = [];
              needsDraw.current = true;
            }}
            className="rounded-full border border-line px-3 py-1 text-muted transition-colors hover:border-faint hover:text-ink"
          >
            reset
          </button>
          <button
            onClick={exportPng}
            className="rounded-full border border-line px-3 py-1 text-muted transition-colors hover:border-faint hover:text-ink"
          >
            save png
          </button>
        </div>

        <div className="border-t border-line pt-5">
          <div className="label mb-2">take it with you</div>
          <p className="mb-3 text-[11.5px] leading-relaxed text-muted">
            these settings, as something you can paste into your own project. no imports, no dependencies.
          </p>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {EXPORTS.map((option) => (
              <button
                key={option.id}
                onClick={() => buildExport(option.id)}
                aria-pressed={exported?.kind === option.id}
                className={`rounded-full border px-3 py-1 transition-colors ${
                  exported?.kind === option.id
                    ? "border-ink bg-ink text-paper"
                    : "border-line text-muted hover:border-faint hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {exported && (
        <section className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="label">
              {EXPORTS.find((e) => e.id === exported.kind)!.filename} · {(exported.code.length / 1024).toFixed(1)} kb
            </h2>
            <div className="flex items-center gap-4 text-[12px] text-muted">
              <button onClick={() => copy(exported.code)} className="transition-colors hover:text-ink">
                {copied ? "copied" : "copy"}
              </button>
              <button
                onClick={() => {
                  const meta = EXPORTS.find((e) => e.id === exported.kind)!;
                  download(meta.filename, new Blob([exported.code], { type: "text/plain;charset=utf-8" }));
                }}
                className="transition-colors hover:text-ink"
              >
                download
              </button>
              <button onClick={() => setExported(null)} className="transition-colors hover:text-ink">
                close
              </button>
            </div>
          </div>
          <pre className="max-h-[26rem] overflow-auto rounded-xl border border-line bg-paper-2 p-4 font-mono text-[11.5px] leading-relaxed text-ink-2">
            {exported.kind === "svg" && exported.code.length > 40000
              ? `${exported.code.slice(0, 40000)}\n\n… ${(exported.code.length - 40000).toLocaleString()} more characters. use download or copy for the whole thing.`
              : exported.code}
          </pre>
        </section>
      )}
    </div>
  );
}
