"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from "react";
import { randomId } from "@/lib/random";
import { BUTTONS_EACH, REACTOR_HANDS } from "@/lib/sus/room";
import type { Mine, SusView } from "@/lib/sus/server/rooms";
import { CAMERAS, TASK_BY_ID, VENT_BY_ID, ZONES, zoneAt, type Task } from "@/lib/sus/ship";
import { useServerNow } from "@/components/game/clock";
import { ErrorLine, Leave } from "@/components/game/room-ui";
import { Bean } from "./Bean";
import { drawCamera, drawScene } from "./draw";
import type { Engine, Hud } from "./engine";
import { GAME, TaskBar, nameOf, playersById } from "./Room";
import { ShipMap } from "./ShipMap";
import { Switches, TaskGame } from "./Tasks";
import type { Snapshot, SusClient } from "./room-client";

/**
 * Playing: the ship on a canvas, you walking about it (WASD, the arrows, or
 * a thumb anywhere on the screen), and the buttons for whatever's in reach.
 * The walking and drawing are ./engine.ts and ./draw.ts; this is everything
 * laid over them.
 */

/** Seconds until `at`, rounded up; 0 once it's passed. */
const until = (at: number | null, now: number) => (at === null ? 0 : Math.max(0, Math.ceil((at - now) / 1000)));

type Open = { kind: "task"; task: Task; seed: string } | { kind: "lights"; seed: string } | { kind: "cameras" } | { kind: "admin" } | { kind: "map" } | { kind: "sabotage" } | null;

export function Play({ view, me, snapshot, client, engine }: { view: SusView; me: string; snapshot: Snapshot; client: SusClient; engine: Engine }) {
  const game = view.game!;
  const mine = snapshot.mine!;
  const hud = useSyncExternalStore(engine.subscribe, engine.getHud, engine.getHud);
  const now = useServerNow(250);
  const [open, setOpen] = useState<Open>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const [killFlash, setKillFlash] = useState(0);
  const [alive, setAlive] = useState(mine.alive);
  const [inVent, setInVent] = useState<string | null>(null);
  // Dying closes whatever you had open.
  if (alive !== mine.alive) {
    setAlive(mine.alive);
    setOpen(null);
  }
  const sabotage = game.sabotage;
  const killIn = until(mine.killAt, now);
  const sabotageIn = until(mine.sabotageAt, now);
  const buttonIn = until(game.buttonAt, now);
  const busy = snapshot.busy;

  useEffect(() => {
    engine.setFrozen(open !== null && open.kind !== "map" && open.kind !== "sabotage");
    engine.setWatching(open?.kind === "cameras");
  }, [engine, open]);
  useEffect(() => () => engine.setFrozen(false), [engine]);

  const close = useCallback(() => setOpen(null), []);

  const press = () => {
    const target = hud.use;
    if (!target) return hud.vent ? enterVent() : undefined;
    switch (target.kind) {
      case "task":
        setOpen({ kind: "task", task: target.task, seed: randomId(8) });
        if (target.task.kind === "scan" && !mine.impostor) void client.begin(target.task.id);
        return;
      case "button":
        if (mine.buttons > 0 && buttonIn === 0 && sabotage?.kind !== "reactor") void client.button();
        return;
      case "cameras":
        return setOpen({ kind: "cameras" });
      case "admin":
        return setOpen({ kind: "admin" });
      case "lights":
        return setOpen({ kind: "lights", seed: randomId(8) });
      case "reactor":
        if (!mine.holding) void client.fix("reactor");
        return;
      case "vent":
        return enterVent();
    }
  };
  const enterVent = () => {
    if (!hud.vent) return;
    engine.enterVent(hud.vent);
    setInVent(hud.vent.id);
  };
  const ventTo = async (to: string) => {
    if (await engine.ventTo(to)) setInVent(to);
  };
  const exitVent = () => {
    engine.exitVent();
    setInVent(null);
  };
  const kill = async () => {
    const target = hud.kill;
    const at = target && engine.whereIs(target);
    if (!target || !at || killIn > 0) return;
    if (await client.kill(target, Math.round(at.x), Math.round(at.y))) {
      engine.jumpTo(at);
      setKillFlash(Date.now());
    }
  };
  const report = () => hud.report && void client.report(hud.report);
  const taskDone = async (task: Task) => {
    setOpen(null);
    if (mine.impostor) return;
    if (await client.task(task.id)) {
      setFinished(task.id);
      setTimeout(() => setFinished((f) => (f === task.id ? null : f)), 1800);
    }
  };

  // The keys: E to use, R to report, Q to kill, V for vents, M for the map.
  const keys = useRef({ press, kill, report, enterVent, exitVent, open });
  useEffect(() => {
    keys.current = { press, kill, report, enterVent, exitVent, open };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      const k = keys.current;
      if (event.code === "Escape") return setOpen(null);
      if (event.code === "KeyM") return setOpen((o) => (o?.kind === "map" ? null : o === null ? { kind: "map" } : o));
      if (k.open && k.open.kind !== "map") return;
      // Space on a focused button presses that button instead.
      if (event.code === "KeyE" || (event.code === "Space" && !(event.target as HTMLElement | null)?.closest("button"))) {
        event.preventDefault();
        k.press();
      } else if (event.code === "KeyR") k.report();
      else if (event.code === "KeyQ") void k.kill();
      else if (event.code === "KeyV") (engine.inVent ? k.exitVent : k.enterVent)();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  const todo = mine.tasks.filter((t) => !t.done).map((t) => TASK_BY_ID.get(t.id)!);
  const vent = inVent ? VENT_BY_ID.get(inVent) : null;

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-[#05070d] text-white [touch-action:none]">
      <Stage engine={engine} />

      {/* Top left: who you are and what's left to do. */}
      <div className="pointer-events-none absolute left-2 top-2 flex w-[min(19rem,calc(100vw-9.5rem))] flex-col gap-1.5 sm:left-3 sm:top-3">
        <div className="pointer-events-auto rounded-xl bg-black/55 px-2.5 py-2 backdrop-blur-sm">
          <TaskBar done={game.tasks.done} total={game.tasks.total} className="[&_span]:!text-white/80" />
        </div>
        <MyTasks mine={mine} finished={finished} />
      </div>

      {/* Top right: the map, and the way out. */}
      <div className="absolute right-2 top-2 flex items-start gap-1.5 sm:right-3 sm:top-3">
        <button type="button" onClick={() => setOpen((o) => (o?.kind === "map" ? null : { kind: "map" }))} aria-label="map (M)" className="grid size-10 place-items-center rounded-xl bg-black/55 hover:bg-black/75">
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
            <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2Z M9 4v14 M15 6v14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex min-h-10 items-center rounded-xl bg-black/55 px-2.5 text-[12px] [&_*]:!text-white/80">
          <Leave game={GAME} client={client} label="leave" />
        </div>
      </div>

      {sabotage && (
        <div role="alert" className="pointer-events-none absolute inset-x-0 top-[6.5rem] mx-auto w-fit max-w-[calc(100vw-1rem)] animate-pulse rounded-xl bg-[#e03131]/90 px-4 py-2 text-center text-[14px] font-bold sm:top-3">
          {sabotage.kind === "reactor" ? `reactor meltdown in ${until(sabotage.ends, now)}s! two hands on the scanners (${sabotage.hands}/${REACTOR_HANDS})` : "the lights are out! fix them in electrical"}
        </div>
      )}
      {sabotage && <div className="pointer-events-none absolute inset-0 animate-pulse bg-[#e03131]/10" aria-hidden />}

      <Notes hud={hud} view={view} me={me} now={now} />
      {!mine.alive && !hud.killedBy && (
        <p className="pointer-events-none absolute inset-x-0 bottom-28 mx-auto w-fit max-w-[calc(100vw-2rem)] rounded-lg bg-black/55 px-3 py-1.5 text-center text-[13px] text-white/85">
          {mine.impostor ? "you're a ghost: you can still sabotage." : "you're a ghost: walk through walls and finish your tasks."}
        </p>
      )}

      {/* Bottom right: what you can do here. */}
      <div className="absolute bottom-3 right-3 flex flex-wrap-reverse items-end justify-end gap-2 sm:bottom-4 sm:right-4">
        {vent ? (
          <>
            {vent.links.map((to) => (
              <Action key={to} label={ZONES[VENT_BY_ID.get(to)!.zone].name} tone="red" onPress={() => void ventTo(to)} disabled={busy} small>
                vent to
              </Action>
            ))}
            <Action label="exit" tone="red" hint="V" onPress={exitVent}>
              <VentIcon />
            </Action>
          </>
        ) : (
          <>
            {mine.impostor && (
              <Action label="sabotage" tone="red" onPress={() => setOpen((o) => (o?.kind === "sabotage" ? null : { kind: "sabotage" }))} disabled={!!sabotage}>
                {sabotageIn > 0 && !sabotage ? <Count n={sabotageIn} /> : "⚠"}
              </Action>
            )}
            {mine.impostor && mine.alive && (
              <Action label="vent" tone="red" hint="V" onPress={enterVent} disabled={!hud.vent}>
                <VentIcon />
              </Action>
            )}
            {mine.impostor && mine.alive && (
              <Action label="kill" tone="red" hint="Q" onPress={() => void kill()} disabled={!hud.kill || killIn > 0 || busy}>
                {killIn > 0 ? <Count n={killIn} /> : "🔪"}
              </Action>
            )}
            {mine.alive && (
              <Action label="report" tone="red" hint="R" onPress={report} disabled={!hud.report || busy}>
                📣
              </Action>
            )}
            {(mine.alive || !mine.impostor) && (
              <Action label={actionLabel(hud, mine)} hint="E" onPress={press} disabled={!hud.use || busy || (hud.use.kind === "button" && (mine.buttons <= 0 || buttonIn > 0 || sabotage?.kind === "reactor"))}>
                {hud.use?.kind === "task" ? "✋" : hud.use?.kind === "button" ? "🚨" : hud.use?.kind === "cameras" ? "📹" : hud.use?.kind === "admin" ? "🗺" : "✋"}
              </Action>
            )}
          </>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-24 mx-auto w-fit max-w-[calc(100vw-2rem)] [&_p]:rounded-lg [&_p]:bg-black/70 [&_p]:px-3 [&_p]:py-1.5">
        <ErrorLine snapshot={snapshot} client={client} />
      </div>

      {open?.kind === "sabotage" && (
        <div className="absolute bottom-28 right-3 flex flex-col gap-2 rounded-xl bg-black/75 p-3 sm:right-4">
          <p className="text-[12.5px] text-white/70">{sabotage ? "one's already going" : sabotageIn > 0 ? `ready in ${sabotageIn}s` : "sabotage the…"}</p>
          {(["lights", "reactor"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={!!sabotage || sabotageIn > 0 || busy}
              onClick={() => {
                void client.sabotage(kind);
                setOpen(null);
              }}
              className="min-h-10 rounded-lg bg-[#e03131] px-4 text-[14px] font-bold hover:bg-[#c92a2a] disabled:opacity-40"
            >
              {kind === "lights" ? "💡 lights" : "☢ reactor"}
            </button>
          ))}
        </div>
      )}

      {open?.kind === "map" && (
        <Panel title="map" onClose={close} wide>
          <ShipMap me={engine.pos} tasks={mine.alive || !mine.impostor ? todo : []} sabotage={sabotage?.kind ?? null} />
          <p className="mt-2 text-[12.5px] text-white/60">you&rsquo;re the red dot; your tasks are yellow. you&rsquo;re in {ZONES[zoneAt(engine.pos.x, engine.pos.y) ?? mine.zone].name}.</p>
        </Panel>
      )}
      {open?.kind === "admin" && (
        <Panel title="admin" onClose={close} wide>
          <ShipMap counts={mine.table} />
          <p className="mt-2 text-[12.5px] text-white/60">how many are in each room right now, alive or not.</p>
        </Panel>
      )}
      {open?.kind === "cameras" && (
        <Panel title="security" onClose={close} wide>
          <Cameras engine={engine} />
        </Panel>
      )}
      {open?.kind === "task" && (
        <Panel title={open.task.name} onClose={close}>
          <TaskGame task={open.task} seed={open.seed} impostor={mine.impostor} onDone={() => void taskDone(open.task)} />
        </Panel>
      )}
      {open?.kind === "lights" && (
        <Panel title="fix lights" onClose={close}>
          <Switches
            seed={open.seed}
            onDone={() => {
              void client.fix("lights");
              setOpen(null);
            }}
          />
        </Panel>
      )}

      {hud.use?.kind === "button" && mine.alive && (
        <p className="pointer-events-none absolute inset-x-0 bottom-28 mx-auto w-fit rounded-lg bg-black/60 px-3 py-1.5 text-[13px]">
          {sabotage?.kind === "reactor" ? "not while the reactor's melting down!" : mine.buttons <= 0 ? "you've used your emergency meeting" : buttonIn > 0 ? `emergency meetings in ${buttonIn}s` : `${mine.buttons}/${BUTTONS_EACH} emergency meeting left`}
        </p>
      )}
      {hud.use?.kind === "reactor" && mine.holding && (
        <p className="pointer-events-none absolute inset-x-0 bottom-28 mx-auto w-fit rounded-lg bg-black/60 px-3 py-1.5 text-[13px]">
          holding the scanner… ({sabotage?.hands ?? 0}/{REACTOR_HANDS})
        </p>
      )}

      {killFlash > 0 && <KillFlash key={killFlash} />}
      {hud.killedBy && <Killed view={view} me={me} killer={hud.killedBy} />}
    </div>
  );
}

function actionLabel(hud: Hud, mine: Mine): string {
  const target = hud.use;
  if (!target) return "use";
  switch (target.kind) {
    case "task":
      return mine.impostor ? "pretend" : target.task.name;
    case "button":
      return "emergency";
    case "cameras":
      return "cameras";
    case "admin":
      return "admin";
    case "lights":
      return "fix lights";
    case "reactor":
      return "hold";
    case "vent":
      return "vent";
  }
}

/* ---------------------------------------------------------------- stage */

/** The canvas, drawn every frame, and the thumbstick over it. */
function Stage({ engine }: { engine: Engine }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLSpanElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const fog = document.createElement("canvas");
    engine.attach();
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      engine.update(dt);
      drawScene(ctx, fog, engine, w, h, dpr, t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      engine.detach();
    };
  }, [engine]);

  const RADIUS_PX = 56;
  const place = (x: number, y: number, dx: number, dy: number) => {
    if (base.current) base.current.style.transform = `translate(${x - RADIUS_PX}px, ${y - RADIUS_PX}px)`;
    if (knob.current) knob.current.style.transform = `translate(${x + dx - 24}px, ${y + dy - 24}px)`;
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (stick.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    stick.current = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    place(stick.current.x, stick.current.y, 0, 0);
    base.current?.parentElement?.setAttribute("data-on", "");
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (!s || s.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - s.x;
    const dy = event.clientY - rect.top - s.y;
    const length = Math.hypot(dx, dy);
    const shown = Math.min(1, RADIUS_PX / Math.max(1, length));
    place(s.x, s.y, dx * shown, dy * shown);
    // A little dead zone in the middle, then full speed well before the edge.
    const strength = length < 8 ? 0 : Math.min(1, length / (RADIUS_PX * 0.7));
    engine.setStick((dx / Math.max(1, length)) * strength, (dy / Math.max(1, length)) * strength);
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (stick.current?.id !== event.pointerId) return;
    stick.current = null;
    engine.setStick(0, 0);
    base.current?.parentElement?.removeAttribute("data-on");
  };

  return (
    <div className="absolute inset-0" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <canvas ref={canvas} className="block size-full" aria-label="the ship: walk with WASD or the arrow keys, or drag anywhere" />
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity data-[on]:opacity-100">
        <span ref={base} className="absolute left-0 top-0 size-28 rounded-full border-2 border-white/40 bg-white/10" />
        <span ref={knob} className="absolute left-0 top-0 size-12 rounded-full bg-white/60 shadow-lg" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ hud */

function Action({ label, hint, tone = "light", disabled = false, small = false, onPress, children }: { label: string; hint?: string; tone?: "light" | "red"; disabled?: boolean; small?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={hint ? `${label} (${hint})` : label}
      className={`relative flex flex-col items-center justify-center rounded-2xl border-2 font-bold shadow-lg transition-transform active:scale-95 disabled:opacity-35 ${small ? "h-16 w-24 text-[12px]" : "size-[4.6rem] text-[26px] sm:size-20"} ${tone === "red" ? "border-[#ff8787] bg-[#c92a2a]/90" : "border-white/80 bg-white/90 text-[#15171a]"}`}
    >
      <span className="leading-none">{children}</span>
      <span className={`mt-1 max-w-full truncate px-1 font-extrabold leading-none ${small ? "text-[11px]" : "text-[10px] uppercase sm:text-[11px]"}`}>{label}</span>
      {hint && <span className="absolute right-1 top-1 hidden rounded bg-black/30 px-1 text-[9.5px] leading-tight text-white/90 [@media(hover:hover)]:block">{hint}</span>}
    </button>
  );
}

const Count = ({ n }: { n: number }) => <span className="font-mono text-[24px] tabular-nums">{n}</span>;

function VentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mx-auto size-7" aria-hidden>
      <rect x={3} y={6} width={18} height={12} rx={2} fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M7 9v6M10.5 9v6M14 9v6M17.5 9v6" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

function MyTasks({ mine, finished }: { mine: Mine; finished: string | null }) {
  // Folded away on a phone, where the ship needs the room.
  const [shown, setShown] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  const tasks = mine.tasks.map((t) => ({ ...t, task: TASK_BY_ID.get(t.id)! }));
  return (
    <section aria-labelledby="tasks" className="pointer-events-auto rounded-xl bg-black/55 px-2.5 py-2 backdrop-blur-sm">
      <button type="button" id="tasks" onClick={() => setShown((s) => !s)} className="flex w-full items-center gap-2 text-left text-[12.5px] font-semibold text-white/85" aria-expanded={shown}>
        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold text-white ${mine.impostor ? "bg-[#e03131]" : "bg-[#15aabf]"}`}>
          {mine.impostor ? "impostor" : "crewmate"}
          {mine.alive ? "" : " · ghost"}
        </span>
        <span className="flex-1">{mine.impostor ? "fake tasks" : "tasks"}</span>
        <span aria-hidden className="text-white/50">
          {shown ? "–" : "+"}
        </span>
      </button>
      {shown && (
        <ul className="mt-1 space-y-0.5">
          {tasks.map(({ id, done, task }) => (
            <li key={id} className={`truncate text-[12.5px] ${done ? "text-[#69db7c]" : "text-white/90"} ${finished === id ? "animate-pop" : ""}`}>
              {ZONES[task.room].name}: {task.name}
              {done ? " ✓" : ""}
            </li>
          ))}
        </ul>
      )}
      {mine.impostor && shown && <p className="mt-1 text-[11.5px] text-[#ff8787]">sabotage and kill everyone.</p>}
    </section>
  );
}

/** What you just saw, for a few seconds. */
function Notes({ hud, view, me, now }: { hud: Hud; view: SusView; me: string; now: number }) {
  const players = playersById(view);
  const latest = hud.notes.at(-1);
  if (!latest || now - latest.t > 3500) return null;
  return (
    <p className="pointer-events-none absolute inset-x-0 top-[10rem] mx-auto w-fit max-w-[calc(100vw-2rem)] animate-pop rounded-lg bg-[#e03131]/85 px-3 py-1.5 text-center text-[14px] font-semibold sm:top-16">
      {noteLine(latest, players, me)}
    </p>
  );
}

export function noteLine(note: Hud["notes"][number], players: ReturnType<typeof playersById>, me: string): string {
  const where = ZONES[note.zone].name;
  const who = note.who.map((id) => nameOf(players, id, me));
  const list = who.length > 1 ? `${who.slice(0, -1).join(", ")} and ${who.at(-1)}` : (who[0] ?? "");
  if (note.kind === "vent-in") return `you saw ${list} jump into a vent in ${where}!`;
  if (note.kind === "vent-out") return `you saw ${list} climb out of a vent in ${where}!`;
  const body = `${nameOf(players, note.whom ?? null, me)}'s body`;
  return who.length ? `${body} in ${where}, and ${list} right by it!` : `${body} in ${where}, and nobody by it`;
}

function Panel({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 p-3" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
      <div role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()} className={`w-full animate-pop rounded-2xl bg-[#1c1f24] p-4 text-white shadow-2xl ${wide ? "max-w-[46rem]" : "max-w-[22rem]"}`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="close" className="grid size-8 place-items-center rounded-md text-[20px] leading-none text-white/70 hover:bg-white/10 hover:text-white">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Security's four screens, live. */
function Cameras({ engine }: { engine: Engine }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      CAMERAS.forEach((camera, i) => {
        const el = refs.current[i];
        const ctx = el?.getContext("2d");
        if (!el || !ctx) return;
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
          el.width = Math.round(w * dpr);
          el.height = Math.round(h * dpr);
        }
        drawCamera(ctx, engine, camera, w, h, dpr, t);
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);
  return (
    <div className="grid grid-cols-2 gap-2">
      {CAMERAS.map((camera, i) => (
        <figure key={camera.id} className="relative overflow-hidden rounded-lg bg-black">
          <canvas
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="block aspect-[3/2] w-full"
          />
          <figcaption className="absolute left-1.5 top-1 flex items-center gap-1 text-[11px] font-semibold text-white/90">
            <span className="size-2 animate-pulse rounded-full bg-[#ff3b3b]" aria-hidden />
            {camera.name}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function KillFlash() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setOn(false), 450);
    return () => clearTimeout(timer);
  }, []);
  return on ? <div className="pointer-events-none absolute inset-0 animate-fade-in bg-[#e03131]/35" aria-hidden /> : null;
}

/** The moment you're killed: who did it, full screen. */
function Killed({ view, me, killer }: { view: SusView; me: string; killer: string }) {
  const players = playersById(view);
  const them = players.get(killer);
  const you = players.get(me);
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-[#8b0000]/85" role="alert">
      <div className="animate-pop text-center">
        <div className="flex items-end justify-center gap-6">
          {them && <Bean color={them.color} className="size-28 sm:size-36" />}
          <span className="pb-6 text-[48px]" aria-hidden>
            🔪
          </span>
          {you && <Bean color={you.color} dead className="size-28 sm:size-36" />}
        </div>
        <p className="mt-4 text-[28px] font-black">{nameOf(players, killer, me)} killed you!</p>
      </div>
    </div>
  );
}
