"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { BIRD_R, BIRD_X, Course, GROUND, HEIGHT, PIPE_SPEED, TICK_MS, WIDTH, startBird, step, type Bird } from "@/lib/flap/game";
import { serverNow } from "@/components/game/clock";
import { drawBird, drawScore, drawWorld } from "./draw";

/**
 * One run of flappy bird on a canvas. Alone, the first tap starts it; in a
 * race it starts itself at `startAt`, by the server's clock, so everyone
 * goes at once. Either way the bird moves in fixed ticks (see
 * lib/flap/game.ts), and every flap is kept by the tick it came on, so the
 * server can play the run back.
 */

/** Where someone else has got to, as heard. */
export interface GhostSample {
  k: number;
  y: number;
  s: number;
  d: number;
}

export interface Ghost {
  name: string;
  color: string;
  samples: GhostSample[];
  /** How far behind they're drawn, in ticks, smoothed. */
  delay?: number;
}

export interface FlapRun {
  flaps: number[];
  bird: Bird;
}

type State = "waiting" | "ready" | "playing" | "dead";

export function FlapCanvas({
  seed,
  startAt,
  limit,
  color = "#f8c630",
  best,
  ghosts,
  onLive,
  onOver,
  onAgain,
  watch = false,
  children,
}: {
  seed: string | null;
  startAt?: number;
  /** Ticks after which a race stops you, still flying. */
  limit?: number;
  color?: string;
  best?: number;
  ghosts?: RefObject<Map<string, Ghost>>;
  onLive?: (bird: Bird) => void;
  onOver: (run: FlapRun) => void;
  onAgain?: () => void;
  /** Only watching a race: no bird of your own. */
  watch?: boolean;
  children?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // What can change mid-run without starting it again.
  const handlers = useRef({ onLive, onOver, onAgain, best, color });
  useEffect(() => {
    handlers.current = { onLive, onOver, onAgain, best, color };
  });

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const course = seed ? new Course(seed) : null;
    const bird = startBird();
    const flaps: number[] = [];
    const race = startAt !== undefined;
    let state: State = watch ? "dead" : race ? "waiting" : "ready";
    let pending = false;
    let acc = 0;
    let last = performance.now();
    let deadAt = watch ? -Infinity : 0;
    /** Where the bird's drawn after it's hit something: it drops to the ground. */
    let fall = { y: 0, vy: 0 };

    const press = () => {
      if (!course) return;
      if (state === "ready") {
        state = "playing";
        pending = true;
        last = performance.now();
        acc = TICK_MS;
      } else if (state === "playing") pending = true;
      else if (state === "dead" && !race && performance.now() - deadAt > 450) handlers.current.onAgain?.();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code !== "Space" && event.code !== "ArrowUp" && event.code !== "KeyW") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a")) return;
      event.preventDefault();
      press();
    };
    const onPointer = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      press();
    };
    window.addEventListener("keydown", onKey);
    el.addEventListener("pointerdown", onPointer);

    const tickOnce = () => {
      const flap = pending;
      pending = false;
      if (flap) flaps.push(bird.tick);
      step(bird, course!, flap);
      handlers.current.onLive?.(bird);
      if (bird.dead || (limit !== undefined && bird.tick >= limit)) {
        state = "dead";
        deadAt = performance.now();
        fall = { y: bird.y, vy: bird.dead ? -3 : 0 };
        handlers.current.onOver({ flaps: [...flaps], bird: { ...bird } });
      }
    };

    let raf = 0;
    const frame = (t: number) => {
      const dt = Math.min(250, t - last);
      last = t;
      if (course && race && state === "waiting" && serverNow() >= startAt!) {
        state = "playing";
        pending = true;
      }
      if (course && state === "playing") {
        if (race) {
          // In a race the clock decides how far you've got, so everyone's on the same tick.
          const due = Math.floor((serverNow() - startAt!) / TICK_MS);
          for (let n = 0; bird.tick <= due && state === "playing" && n < 300; n++) tickOnce();
        } else {
          acc += dt;
          for (let n = 0; acc >= TICK_MS && state === "playing" && n < 30; n++) {
            acc -= TICK_MS;
            tickOnce();
          }
        }
      }
      if (state === "dead" && bird.dead) {
        fall.vy = Math.min(10, fall.vy + 0.6);
        fall.y = Math.min(GROUND - BIRD_R, fall.y + fall.vy * (dt / TICK_MS));
      }

      // Draw.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      const scale = (w / WIDTH) * dpr;
      // A shake as you hit.
      const since = state === "dead" && bird.dead ? t - deadAt : Infinity;
      const shake = since < 200 ? (1 - since / 200) * 4 : 0;
      ctx.setTransform(scale, 0, 0, scale, Math.sin(t) * shake * scale, Math.cos(t * 1.3) * shake * scale);
      // Watching others after you're out, the course carries on by the clock.
      const watching = race && state === "dead" && t - deadAt > 1200;
      const viewTick = watching ? Math.max(bird.tick, Math.floor((serverNow() - startAt!) / TICK_MS)) : bird.tick;
      if (course) drawWorld(ctx, course, viewTick);
      else {
        ctx.fillStyle = "#3fb4c7";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }

      // Everyone else, a moment behind where they said they were.
      const board: { name: string; s: number; d: number; color: string }[] = [];
      for (const ghost of ghosts?.current?.values() ?? []) {
        const samples = ghost.samples;
        const latest = samples.at(-1);
        if (!latest) continue;
        board.push({ name: ghost.name, s: latest.s, d: latest.d, color: ghost.color });
        if (state === "waiting" || state === "ready") continue;
        const lag = viewTick - latest.k + 6;
        ghost.delay = ghost.delay === undefined ? lag : ghost.delay * 0.92 + lag * 0.08;
        const back = Math.max(6, Math.min(45, ghost.delay));
        const at = viewTick - back;
        let y = latest.y;
        for (let i = samples.length - 1; i > 0; i--) {
          const a = samples[i - 1];
          const b = samples[i];
          if (a.k <= at && at <= b.k) {
            y = a.y + ((b.y - a.y) * (at - a.k)) / Math.max(1, b.k - a.k);
            break;
          }
        }
        const gone = latest.d && at >= latest.k;
        if (at < 0 || (gone && at - latest.k > 60)) continue;
        drawBird(ctx, { x: BIRD_X - back * PIPE_SPEED, y, vy: 0, tick: at, body: ghost.color, alpha: gone ? 0.25 : 0.55, name: ghost.name, dead: !!gone });
      }

      if (!watching) {
        const idle = state === "ready" || state === "waiting";
        const y = state === "dead" && bird.dead ? fall.y : idle ? bird.y + Math.sin(t / 180) * 6 : bird.y;
        drawBird(ctx, { x: BIRD_X, y, vy: state === "dead" ? Math.max(bird.vy, fall.vy + 4) : idle ? 0 : bird.vy, tick: idle ? t / 30 : bird.tick, body: handlers.current.color, dead: state === "dead" && bird.dead });
      }
      if (!watch && state !== "ready" && state !== "waiting") drawScore(ctx, bird.score);
      if (state === "dead" && since < 90) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }

      if (board.length) {
        ctx.font = "700 11px system-ui, sans-serif";
        ctx.textAlign = "left";
        board.sort((a, b) => b.s - a.s);
        board.forEach((row, i) => {
          const y = 100 + i * 16;
          ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
          ctx.fillRect(6, y - 11, 92, 15);
          ctx.fillStyle = row.color;
          ctx.fillRect(9, y - 7, 7, 7);
          ctx.fillStyle = row.d ? "rgba(255, 255, 255, 0.55)" : "#ffffff";
          ctx.fillText(`${row.name.slice(0, 9)} ${row.s}${row.d ? " ✗" : ""}`, 20, y);
        });
      }

      if (state === "ready" && course) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 28px system-ui, sans-serif";
        ctx.lineWidth = 5;
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#3a2a14";
        ctx.strokeText("get ready", WIDTH / 2, 130);
        ctx.fillStyle = "#ffd84a";
        ctx.fillText("get ready", WIDTH / 2, 130);
        ctx.font = "700 14px system-ui, sans-serif";
        ctx.lineWidth = 3;
        const hint = "tap, click or press space to flap";
        ctx.strokeText(hint, WIDTH / 2, 300);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(hint, WIDTH / 2, 300);
        const best = handlers.current.best;
        if (best) {
          ctx.strokeText(`your best: ${best}`, WIDTH / 2, 322);
          ctx.fillText(`your best: ${best}`, WIDTH / 2, 322);
        }
        ctx.restore();
      }
      if (!course) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "700 14px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("getting ready…", WIDTH / 2, HEIGHT / 2);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      el.removeEventListener("pointerdown", onPointer);
    };
  }, [seed, startAt, limit, ghosts, watch]);

  return (
    <div className="relative mx-auto w-full max-w-[20rem] select-none overflow-hidden rounded-xl border border-faint/70 [touch-action:manipulation]">
      <canvas ref={canvas} className="block aspect-[288/512] w-full cursor-pointer" aria-label="flappy bird: tap, click or press space to flap" />
      {children}
    </div>
  );
}
