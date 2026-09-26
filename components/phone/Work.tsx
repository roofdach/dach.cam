"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isOp, type Op } from "@/lib/draw/ink";
import { MAX_TEXT, fitDrawing } from "@/lib/phone/room";
import { serverNow } from "@/components/game/clock";
import { Painter, Pen, Replayer, Surface, Toolbar, useTools } from "@/components/game/sketch";
import { KEYS, forget, isString, load, save } from "@/components/game/storage";
import { Button, Spinner } from "@/components/game/ui";

/**
 * The steps themselves: writing, drawing and describing, each keeping a
 * draft in the browser so a reload loses nothing, and handing in whatever
 * is there as time runs out; and the drawings, shown still or drawn out.
 */

const isOps = (value: unknown): value is Op[] => Array.isArray(value) && value.every(isOp);

/** Handed in this long before time's up, so it arrives in time. */
const EARLY_MS = 1500;

/** Calls `handIn` once, just before `ends`. */
function useDeadline(ends: number, handIn: () => void) {
  const latest = useRef(handIn);
  useEffect(() => {
    latest.current = handIn;
  });
  useEffect(() => {
    let fired = false;
    const timer = setInterval(() => {
      if (fired || serverNow() < ends - EARLY_MS) return;
      fired = true;
      latest.current();
    }, 250);
    return () => clearInterval(timer);
  }, [ends]);
}

/** Drafts from steps that are over only take up space. */
export function forgetOldDrafts(code: string, keep: string) {
  try {
    const prefix = KEYS.phoneDraft(code, 0, 0).replace(/0:0$/, "");
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix) && key !== keep) window.localStorage.removeItem(key);
    }
  } catch {
    // Nothing remembered, nothing to forget.
  }
}

/* ---------------------------------------------------------------- text */

export function TextTask({
  draft,
  ends,
  label,
  placeholder,
  busy,
  onHandIn,
  children,
}: {
  /** Where the draft is kept. */
  draft: string;
  ends: number;
  label: string;
  placeholder: string;
  busy: boolean;
  onHandIn: (text: string) => Promise<boolean>;
  /** Shown above the box, like the drawing to describe. */
  children?: ReactNode;
}) {
  const [text, setText] = useState(() => load(draft, isString) ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const handIn = async (automatic = false) => {
    const trimmed = text.trim();
    if (!trimmed) {
      if (!automatic) setProblem("write something first");
      return;
    }
    if (await onHandIn(trimmed)) forget(draft);
  };
  useDeadline(ends, () => void handIn(true));

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void handIn();
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      {children}
      <form onSubmit={submit} className="mx-auto flex w-full max-w-[40rem] flex-col gap-2">
        <label htmlFor="work" className="text-[13px] text-muted">
          {label}
        </label>
        <div className="flex gap-2">
          <input
            ref={input}
            id="work"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setProblem(null);
              save(draft, e.target.value);
            }}
            maxLength={MAX_TEXT}
            autoComplete="off"
            placeholder={placeholder}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-faint bg-paper px-3 text-[16px] outline-none placeholder:text-faint focus:border-ink"
          />
          <Button tone="solid" type="submit" disabled={busy} className="min-h-11 px-5">
            {busy ? <Spinner /> : "done"}
          </Button>
        </div>
        {problem && (
          <p role="alert" className="text-[13px] text-accent">
            {problem}
          </p>
        )}
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- drawing */

export function DrawTask({ draft, ends, busy, onHandIn }: { draft: string; ends: number; busy: boolean; onHandIn: (ops: Op[]) => Promise<boolean> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pen = useRef<Pen | null>(null);
  const [tools, pick] = useTools();
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const painter = new Painter(element);
    // Every stroke is kept as it's finished, so a reload carries on where you were.
    const own: Pen = new Pen(painter, { add: () => save(draft, own.ops) });
    const saved = load(draft, isOps);
    if (saved) own.restore(saved);
    pen.current = own;
    return () => {
      own.up();
      pen.current = null;
    };
  }, [draft]);

  const handIn = async (automatic = false) => {
    const own = pen.current;
    if (!own) return;
    own.up();
    const ops = fitDrawing(own.ops);
    if (!ops) {
      if (!automatic) setProblem("draw something first");
      return;
    }
    if (await onHandIn(ops)) forget(draft);
  };
  useDeadline(ends, () => void handIn(true));

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
      <Surface canvas={canvas} pen={pen} live={!busy} tools={tools} label="your drawing" />
      <Toolbar tools={tools} onPick={pick} onUndo={() => pen.current?.undo()} onClear={() => pen.current?.clear()} disabled={busy}>
        <Button tone="solid" onClick={() => void handIn()} disabled={busy} className="min-h-10 px-5">
          {busy ? <Spinner /> : "done"}
        </Button>
      </Toolbar>
      {problem && (
        <p role="alert" className="text-center text-[13px] text-accent">
          {problem}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- showing */

const STILL = { tool: "brush", color: 0, size: 0 } as const;

/** Someone's drawing, fitted to the room there is, to describe. */
export function FittedPicture({ ops }: { ops: Op[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) new Painter(canvas.current).replay(ops);
  }, [ops]);
  return <Surface canvas={canvas} live={false} tools={STILL} label="the drawing to describe" />;
}

/** A drawing in a finished chain: drawn out stroke by stroke the first time it's shown, or all at once. */
export function Picture({ ops, animate, label }: { ops: Op[]; animate: boolean; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const replayer = new Replayer(new Painter(canvas.current), 2500);
    replayer.add(ops, !animate);
    return () => replayer.dispose();
  }, [ops, animate]);
  return (
    <canvas
      ref={canvas}
      width={800}
      height={600}
      role="img"
      aria-label={label}
      className="block aspect-[4/3] w-full rounded-lg bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.14),0_1px_3px_rgb(0_0_0/0.08)]"
    />
  );
}
