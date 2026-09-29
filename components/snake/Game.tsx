"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { COLS, GOLD_STEPS, Game, ROWS, opposite, stepMs, type Dir, type Snake } from "@/lib/snake/game";
import { serverNow } from "@/components/game/clock";
import { drawBoard } from "./draw";

/**
 * One game of snake on a canvas. Alone, the first arrow (or swipe) sets it
 * going; in a race it goes by itself at `startAt`, by the server's clock,
 * and its steps are counted off that clock so everyone's in step. Turns are
 * kept by the step they came before, so the server can play the game back.
 */

export interface SnakeRun {
  turns: [number, Dir][];
  snake: Snake;
}

type State = "waiting" | "ready" | "playing" | "dead";

const KEYS: Record<string, Dir> = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };

export function SnakeCanvas({
  seed,
  startAt,
  limitMs,
  color,
  best,
  watch = false,
  onLive,
  onOver,
  onAgain,
  children,
}: {
  seed: string | null;
  startAt?: number;
  /** How long a race goes on: past it, you stop where you are. */
  limitMs?: number;
  color?: string;
  best?: number;
  /** Only watching a race: no snake of your own. */
  watch?: boolean;
  onLive?: (snake: Snake) => void;
  onOver: (run: SnakeRun) => void;
  onAgain?: () => void;
  children?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const press = useRef<(dir: Dir) => void>(() => {});
  const [score, setScore] = useState(0);
  const handlers = useRef({ onLive, onOver, onAgain, color });
  useEffect(() => {
    handlers.current = { onLive, onOver, onAgain, color };
  });

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const game = seed ? new Game(seed) : null;
    const s = game?.snake;
    const race = startAt !== undefined;
    let state: State = watch ? "dead" : race ? "waiting" : "ready";
    const queue: Dir[] = [];
    const turns: [number, Dir][] = [];
    let acc = 0;
    let spent = 0;
    let last = performance.now();
    let deadAt = 0;
    let shown = 0;

    press.current = (dir: Dir) => {
      if (!game) return;
      if (state === "dead") {
        if (!race && performance.now() - deadAt > 450) handlers.current.onAgain?.();
        return;
      }
      if (queue.length >= 3) return;
      queue.push(dir);
      if (state === "ready") {
        state = "playing";
        last = performance.now();
        acc = 0;
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (event.code in KEYS) {
        event.preventDefault();
        if (!event.repeat) press.current(KEYS[event.code]);
      } else if ((event.code === "Space" || event.code === "Enter") && state === "dead" && !target?.closest("button, a")) {
        event.preventDefault();
        press.current(1);
      }
    };
    // A swipe turns as soon as it's gone far enough, and can keep going the other way.
    let from: { x: number; y: number; id: number } | null = null;
    const onDown = (event: PointerEvent) => {
      from = { x: event.clientX, y: event.clientY, id: event.pointerId };
      if (state === "ready" || state === "dead") press.current(1);
    };
    const onMove = (event: PointerEvent) => {
      if (!from || from.id !== event.pointerId) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      press.current(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
      from = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const onUp = () => (from = null);
    window.addEventListener("keydown", onKey);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

    const stepOnce = () => {
      let turn: Dir | undefined;
      while (queue.length) {
        const d = queue.shift()!;
        if (d !== s!.dir && !opposite(d, s!.dir)) {
          turn = d;
          break;
        }
      }
      if (turn !== undefined) turns.push([s!.step, turn]);
      game!.step(turn);
      handlers.current.onLive?.(s!);
      if (s!.score !== shown) {
        shown = s!.score;
        setScore(shown);
      }
      if (s!.dead) {
        state = "dead";
        deadAt = performance.now();
        handlers.current.onOver({ turns: [...turns], snake: { ...s!, body: [...s!.body] } });
      }
    };
    const stop = () => {
      state = "dead";
      deadAt = performance.now();
      handlers.current.onOver({ turns: [...turns], snake: { ...s!, body: [...s!.body] } });
    };

    let raf = 0;
    const frame = (t: number) => {
      const dt = Math.min(250, t - last);
      last = t;
      let through = 1;
      if (game && race && state === "waiting" && serverNow() >= startAt!) state = "playing";
      if (game && state === "playing") {
        if (race) {
          const elapsed = serverNow() - startAt!;
          for (let n = 0; state === "playing" && spent + stepMs(s!) <= elapsed && n < 200; n++) {
            if (limitMs !== undefined && spent + stepMs(s!) > limitMs) break;
            spent += stepMs(s!);
            stepOnce();
          }
          if (state === "playing" && limitMs !== undefined && spent + stepMs(s!) > limitMs) stop();
          through = (elapsed - spent) / stepMs(s!);
        } else {
          acc += dt;
          for (let n = 0; state === "playing" && acc >= stepMs(s!) && n < 20; n++) {
            acc -= stepMs(s!);
            stepOnce();
          }
          through = acc / stepMs(s!);
        }
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const size = w / COLS;
      if (s) {
        drawBoard(
          ctx,
          {
            body: watch ? [] : s.body,
            dir: s.dir,
            apple: watch ? -1 : s.apple,
            gold: !watch && s.gold ? s.gold.cell : -1,
            goldLeft: s.gold ? (s.gold.until - s.step) / GOLD_STEPS : 0,
            dead: s.dead,
            color: handlers.current.color,
            t: state === "playing" ? through : 1,
          },
          size,
          t,
        );
      }
      const message = !game ? "getting ready…" : state === "ready" ? (w < 420 ? "swipe, or tap an arrow, to go" : "press an arrow key, or swipe, to go") : watch ? "watching" : null;
      if (message) {
        // Up top, out of the snake's way.
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        ctx.fillRect(0, h * 0.2 - 20, w, 40);
        ctx.fillStyle = "#ffffff";
        ctx.font = "700 15px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(message, w / 2, h * 0.2);
      }
      if (state === "dead" && !watch && performance.now() - deadAt < 120) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.fillRect(0, 0, w, h);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [seed, startAt, limitMs, watch]);

  const pad = (dir: Dir, label: string, arrow: string) => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        press.current(dir);
      }}
      className="grid size-14 place-items-center rounded-xl bg-[#578a34] text-[22px] text-white shadow-[0_3px_0_#3e6524] active:translate-y-0.5 active:shadow-none"
    >
      {arrow}
    </button>
  );

  return (
    <div className="w-full">
      <div className="flex items-center justify-between rounded-t-xl bg-[#4a752c] px-3 py-1.5 text-white">
        <span className="flex items-center gap-1.5 text-[15px] font-bold tabular-nums">
          <span aria-hidden className="size-3 rounded-full bg-[#e7471d]" /> {watch ? "–" : score}
        </span>
        {best !== undefined && <span className="text-[13px] tabular-nums text-white/85">best {Math.max(best, score)}</span>}
      </div>
      <div className="relative select-none overflow-hidden rounded-b-xl [touch-action:none]">
        <canvas ref={canvas} className="block w-full cursor-pointer" style={{ aspectRatio: `${COLS} / ${ROWS}` }} aria-label="snake: arrow keys or WASD to turn, or swipe" />
        {children}
      </div>
      {!watch && (
        <div className="mx-auto mt-3 grid w-fit grid-cols-3 gap-1.5 [@media(hover:hover)_and_(pointer:fine)_and_(min-width:640px)]:hidden">
          <span />
          {pad(0, "up", "▲")}
          <span />
          {pad(3, "left", "◀")}
          {pad(2, "down", "▼")}
          {pad(1, "right", "▶")}
        </div>
      )}
    </div>
  );
}
