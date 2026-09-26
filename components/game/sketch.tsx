"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { BLACK, COLORS, HEIGHT, SIZES, WHITE, WIDTH, floodFill, lastStroke, nextStroke, visible, type Op } from "@/lib/draw/ink";

/**
 * Drawing, for the games that draw: a board of 800 by 600 whatever size it
 * shows at, what paints on it, a pen that records what you draw as a list of
 * operations (see lib/draw/ink.ts), a replay that plays someone else's list
 * back as if it were being drawn, and the tools.
 */

/* ------------------------------------------------------------ painting */

type Line = Extract<Op, ["l", ...unknown[]]>;

const pointsIn = (op: Line) => (op.length - 4) / 2;
const px = (op: Line, i: number) => op[4 + 2 * i] as number;
const py = (op: Line, i: number) => op[5 + 2 * i] as number;

/** Paints operations onto the board. */
export class Painter {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    // Fills read the board back, which is quicker kept in memory than on the graphics card.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("this browser can't draw on a canvas");
    this.ctx = ctx;
    this.wipe();
  }

  wipe() {
    this.ctx.fillStyle = COLORS[WHITE];
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  /** Points `from` to `to` of a line, joined on to the point before `from`. */
  line(op: Line, from = 0, to = pointsIn(op) - 1) {
    if (to < from) return;
    const ctx = this.ctx;
    const color = COLORS[op[2]];
    const width = SIZES[op[3]];
    const start = Math.max(0, from - 1);
    if (to === start) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px(op, to), py(op, to), width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(px(op, start), py(op, start));
    for (let i = start + 1; i <= to; i++) ctx.lineTo(px(op, i), py(op, i));
    ctx.stroke();
  }

  op(op: Op) {
    if (op[0] === "l") this.line(op);
    else if (op[0] === "c") this.wipe();
    else if (op[0] === "f") {
      const image = this.ctx.getImageData(0, 0, WIDTH, HEIGHT);
      floodFill(image.data, WIDTH, HEIGHT, op[3], op[4], COLORS[op[2]]);
      this.ctx.putImageData(image, 0, 0);
    }
  }

  /** Starts again from blank and paints everything that's still showing. */
  replay(ops: readonly Op[]) {
    this.wipe();
    for (const op of visible(ops)) this.op(op);
  }
}

/* ------------------------------------------------------------ watching */

/** What a fill, clear or undo counts for when pacing a replay, in points of line. */
const STEP = 6;

/**
 * Plays a drawing back the way it was drawn. Strokes handed to it are drawn
 * out over about `spread` milliseconds, speeding up if more arrive before
 * it's done, so a drawing that arrives a second at a time moves rather than
 * jumps.
 */
export class Replayer {
  private readonly painter: Painter;
  private readonly spread: number;
  private applied: Op[] = [];
  private queue: Op[] = [];
  /** How much of the line at the front of the queue is drawn. */
  private cursor = 0;
  private rate = 0;
  private budget = 0;
  private frame = 0;
  private last = 0;

  constructor(painter: Painter, spread = 900) {
    this.painter = painter;
    this.spread = spread;
  }

  add(ops: Op[], instant = false) {
    this.queue.push(...ops);
    let points = -this.cursor;
    for (const op of this.queue) points += op[0] === "l" ? pointsIn(op) : STEP;
    if (instant || document.visibilityState === "hidden") return this.flush();
    this.rate = Math.max(points / this.spread, 0.02);
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  /** Draws up to `budget` points' worth from the queue; returns what's left over. */
  private advance(budget: number): number {
    while (this.queue.length > 0 && budget > 0) {
      const op = this.queue[0];
      if (op[0] === "l") {
        const count = pointsIn(op);
        const take = Math.min(count - this.cursor, Math.max(1, Math.floor(budget)));
        this.painter.line(op, this.cursor, this.cursor + take - 1);
        this.cursor += take;
        budget -= take;
        if (this.cursor < count) continue;
      } else {
        budget -= STEP;
        if (op[0] !== "u") this.painter.op(op);
      }
      this.applied.push(op);
      this.queue.shift();
      this.cursor = 0;
      if (op[0] === "u") this.painter.replay(this.applied);
    }
    return budget;
  }

  private tick = (time: number) => {
    this.frame = 0;
    // A long gap means the tab was hidden; catch up at once.
    if (this.last && time - this.last > 500) return this.flush();
    const dt = this.last ? time - this.last : 16;
    this.last = time;
    this.budget = this.advance(this.budget + this.rate * dt);
    if (this.queue.length > 0) this.frame = requestAnimationFrame(this.tick);
    else this.last = this.budget = 0;
  };

  flush() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.advance(Infinity);
    this.last = this.budget = 0;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}

/* ------------------------------------------------------------- drawing */

export type Tool = "brush" | "fill";

export interface Tools {
  tool: Tool;
  color: number;
  size: number;
}

/** Your tools stay as you left them from one drawing to the next. */
let lastTools: Tools = { tool: "brush", color: BLACK, size: 1 };

export function useTools(): [Tools, (patch: Partial<Tools>) => void] {
  const [tools, setTools] = useState<Tools>(lastTools);
  const pick = (patch: Partial<Tools>) => {
    const next = { ...tools, ...patch };
    lastTools = next;
    setTools(next);
  };
  return [tools, pick];
}

/** Where a pen's operations go as they're made: out to the room, or into a draft. */
export interface InkSink {
  add(op: Op): void;
}

/**
 * A pen: paints at once, and hands every operation on. A long stroke can be
 * handed on in pieces as it's drawn (`cut`), each piece starting from where
 * the last one stopped so the pieces join up.
 */
export class Pen {
  ops: Op[] = [];
  private readonly painter: Painter;
  private readonly sink: InkSink | null;
  private stroke: { id: number; color: number; size: number; points: number[]; sent: number } | null = null;
  private next = 0;

  constructor(painter: Painter, sink: InkSink | null = null) {
    this.painter = painter;
    this.sink = sink;
  }

  /** Carries on from a drawing already begun. */
  restore(ops: Op[]) {
    this.ops = [...ops];
    this.next = nextStroke(ops);
    this.painter.replay(this.ops);
  }

  private push(op: Op) {
    this.ops.push(op);
    this.sink?.add(op);
  }

  down(x: number, y: number, tools: Tools) {
    this.up();
    if (tools.tool === "fill") {
      const op: Op = ["f", this.next++, tools.color, x, y];
      this.painter.op(op);
      this.push(op);
      return;
    }
    this.stroke = { id: this.next++, color: tools.color, size: tools.size, points: [x, y], sent: 0 };
    this.painter.line(["l", 0, tools.color, tools.size, x, y]);
  }

  move(x: number, y: number) {
    const stroke = this.stroke;
    if (!stroke) return;
    const n = stroke.points.length;
    const lastX = stroke.points[n - 2];
    const lastY = stroke.points[n - 1];
    // Points a pixel or so apart add nothing but bytes.
    if ((x - lastX) ** 2 + (y - lastY) ** 2 < 4) return;
    stroke.points.push(x, y);
    this.painter.line(["l", 0, stroke.color, stroke.size, lastX, lastY, x, y]);
  }

  up() {
    this.cut();
    this.stroke = null;
  }

  /** Hands on what's new of the stroke in progress. */
  cut() {
    const stroke = this.stroke;
    if (!stroke) return;
    const count = stroke.points.length / 2;
    if (stroke.sent >= count) return;
    const from = Math.max(0, stroke.sent - 1);
    this.push(["l", stroke.id, stroke.color, stroke.size, ...stroke.points.slice(from * 2)] as Line);
    stroke.sent = count;
  }

  undo() {
    this.up();
    const id = lastStroke(this.ops);
    if (id === null) return;
    this.push(["u", id]);
    this.painter.replay(this.ops);
  }

  clear() {
    this.up();
    if (visible(this.ops).length === 0) return;
    const op: Op = ["c", this.next++];
    this.painter.op(op);
    this.push(op);
  }
}

/* ------------------------------------------------------------- surface */

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The board on the page: the biggest four-by-three that fits the room it's
 * given, taking pointer input for `pen` while `live`. `children` float over
 * it.
 */
export function Surface({
  canvas,
  pen,
  live,
  tools,
  label,
  children,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  pen?: RefObject<Pen | null>;
  live: boolean;
  tools: Tools;
  label: string;
  children?: ReactNode;
}) {
  const area = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const rect = useRef<DOMRect | null>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const w = Math.max(0, Math.floor(Math.min(width, (height * WIDTH) / HEIGHT)));
      setBox((b) => (b?.width === w ? b : { width: w, height: Math.floor((w * HEIGHT) / WIDTH) }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Ctrl+Z, or ⌘Z, takes back a stroke.
  useEffect(() => {
    if (!live) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && !isTyping(event.target)) {
        event.preventDefault();
        pen?.current?.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, pen]);

  // Time's up mid-stroke: finish it.
  useEffect(() => {
    if (!live) pen?.current?.up();
  }, [live, pen]);

  const toBoard = (event: { clientX: number; clientY: number }, r: DOMRect) => [
    Math.round(Math.min(WIDTH, Math.max(0, ((event.clientX - r.left) / r.width) * WIDTH))),
    Math.round(Math.min(HEIGHT, Math.max(0, ((event.clientY - r.top) / r.height) * HEIGHT))),
  ];

  const showCursor = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const ring = cursor.current;
    if (!ring) return;
    if (!live || tools.tool !== "brush" || event.pointerType === "touch") {
      ring.style.opacity = "0";
      return;
    }
    const r = event.currentTarget.getBoundingClientRect();
    const d = Math.max(4, (SIZES[tools.size] * r.width) / WIDTH);
    ring.style.width = ring.style.height = `${d}px`;
    ring.style.transform = `translate(${event.clientX - r.left - d / 2}px, ${event.clientY - r.top - d / 2}px)`;
    ring.style.opacity = "1";
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const own = pen?.current;
    if (!live || !own || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    rect.current = event.currentTarget.getBoundingClientRect();
    const [x, y] = toBoard(event, rect.current);
    own.down(x, y, tools);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    showCursor(event);
    const own = pen?.current;
    if (!live || !own || !rect.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    // Every point the mouse passed through since the last frame, not just the last, so fast strokes stay round.
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const e of events.length > 0 ? events : [event.nativeEvent]) {
      const [x, y] = toBoard(e, rect.current);
      own.move(x, y);
    }
  };

  const onPointerUp = () => {
    pen?.current?.up();
    rect.current = null;
  };

  return (
    <div ref={area} className="relative grid aspect-[4/3] w-full place-items-center lg:aspect-auto lg:min-h-0 lg:flex-1">
      <div
        className="relative overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.14),0_1px_3px_rgb(0_0_0/0.08)]"
        style={box ? { width: box.width, height: box.height } : { width: "100%", height: "100%" }}
      >
        <canvas
          ref={canvas}
          width={WIDTH}
          height={HEIGHT}
          aria-label={label}
          role="img"
          className="block size-full touch-none select-none"
          style={{ cursor: live ? (tools.tool === "brush" ? "none" : "crosshair") : "default" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onPointerUp}
          onPointerLeave={() => cursor.current && (cursor.current.style.opacity = "0")}
        />
        <div
          ref={cursor}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 rounded-full border border-black/70 opacity-0 shadow-[0_0_0_1px_rgb(255_255_255/0.8)]"
        />
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- toolbar */

const COLOR_NAMES = [
  "white", "light grey", "red", "orange", "yellow", "green", "sky blue", "blue", "purple", "pink", "brown", "peach",
  "black", "dark grey", "dark red", "dark orange", "gold", "dark green", "dark blue", "navy", "dark purple", "dark pink", "dark brown", "tan",
];

const SIZE_NAMES = ["thin", "medium", "thick", "huge"];

function ToolButton({ label, pressed, onClick, disabled, children }: { label: string; pressed?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className="grid size-9 place-items-center rounded-lg border border-faint/70 text-ink transition-colors hover:border-ink/40 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Toolbar({
  tools,
  onPick,
  onUndo,
  onClear,
  disabled,
  children,
}: {
  tools: Tools;
  onPick: (patch: Partial<Tools>) => void;
  onUndo: () => void;
  onClear: () => void;
  disabled: boolean;
  /** More at the end of the row, like a "done" button. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
      <div role="group" aria-label="colour" className="grid grid-cols-12 overflow-hidden rounded-md shadow-[0_0_0_1px_rgb(0_0_0/0.15)]">
        {COLORS.map((color, i) => (
          <button
            key={color}
            type="button"
            title={COLOR_NAMES[i]}
            aria-label={COLOR_NAMES[i]}
            aria-pressed={tools.color === i}
            disabled={disabled}
            onClick={() => onPick({ color: i })}
            className="relative size-[22px] aria-pressed:z-10 aria-pressed:shadow-[inset_0_0_0_2px_#fff,0_0_0_2px_var(--ink)]"
            style={{ background: color }}
          />
        ))}
      </div>
      <div role="group" aria-label="brush size" className="flex gap-1">
        {SIZES.map((size, i) => (
          <ToolButton key={size} label={`${SIZE_NAMES[i]} brush`} pressed={tools.size === i} onClick={() => onPick({ size: i, tool: "brush" })} disabled={disabled}>
            <span className="rounded-full bg-current" style={{ width: 3 + i * 5, height: 3 + i * 5 }} />
          </ToolButton>
        ))}
      </div>
      <div role="group" aria-label="tool" className="flex gap-1">
        <ToolButton label="brush" pressed={tools.tool === "brush"} onClick={() => onPick({ tool: "brush" })} disabled={disabled}>
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </ToolButton>
        <ToolButton label="fill" pressed={tools.tool === "fill"} onClick={() => onPick({ tool: "fill" })} disabled={disabled}>
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" />
            <path d="m5 2 5 5M2 13h15" />
            <path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" />
          </svg>
        </ToolButton>
      </div>
      <div className="flex gap-1">
        <ToolButton label="undo (ctrl+z)" onClick={onUndo} disabled={disabled}>
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        </ToolButton>
        <ToolButton label="clear the board" onClick={onClear} disabled={disabled}>
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </svg>
        </ToolButton>
      </div>
      {children}
    </div>
  );
}
