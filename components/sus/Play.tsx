"use client";

import { useEffect, useState, type ReactNode } from "react";
import { randomId } from "@/lib/random";
import { BUTTONS_EACH, REACTOR_HANDS, type Note, type PlayerView } from "@/lib/sus/room";
import type { Mine, SusView } from "@/lib/sus/server/rooms";
import { ROOMS, SPOTS, TASK_BY_ID, exitsFrom, ventsFrom, type RoomId, type Task } from "@/lib/sus/ship";
import { useServerNow } from "@/components/game/clock";
import { Crumbs, ErrorLine, Leave } from "@/components/game/room-ui";
import { Button } from "@/components/game/ui";
import { Bean } from "./Bean";
import { GAME, TaskBar, nameOf, playersById } from "./Room";
import { Ship } from "./Ship";
import { Switches, TaskGame } from "./Tasks";
import type { Snapshot, SusClient } from "./room-client";

const RED = "bg-[#e03131] text-white hover:bg-[#c92a2a] disabled:bg-[#e03131]/40";

/** Seconds until `at`, rounded up; 0 once it's passed. */
const until = (at: number | null, now: number) => (at === null ? 0 : Math.max(0, Math.ceil((at - now) / 1000)));

/** What you saw, in words. */
function seenLine(note: Note, players: Map<string, PlayerView>, me: string) {
  const where = ROOMS[note.room].name;
  return note.kind === "kill" ? `you saw ${nameOf(players, note.who, me)} kill ${nameOf(players, note.whom, me)} in ${where}!` : `you saw ${nameOf(players, note.who, me)} use a vent in ${where}!`;
}

type Open = { kind: "task"; task: Task; seed: string; opened: number } | { kind: "lights"; seed: string } | null;

export function Play({ view, me, snapshot, client }: { view: SusView; me: string; snapshot: Snapshot; client: SusClient }) {
  const game = view.game!;
  const mine = snapshot.mine!;
  const players = playersById(view);
  const now = useServerNow(250);
  const [open, setOpen] = useState<Open>(null);
  const [room, setRoom] = useState(mine.room);
  const [finished, setFinished] = useState<string | null>(null);
  // Anything open closes when you're somewhere else.
  if (room !== mine.room) {
    setRoom(mine.room);
    setOpen(null);
  }
  const ready = now >= mine.moveAt && !snapshot.busy;
  const sabotage = game.sabotage;

  const openTask = (task: Task) => {
    const opened = Date.now();
    setOpen({ kind: "task", task, seed: randomId(8), opened });
    if (task.kind === "scan" && !mine.impostor) void client.begin(task.id);
  };
  const taskDone = async (task: Task) => {
    if (mine.impostor) {
      setOpen(null);
      return;
    }
    if (await client.task(task.id)) {
      setFinished(task.id);
      setTimeout(() => setFinished((f) => (f === task.id ? null : f)), 1500);
    }
    setOpen(null);
  };

  return (
    <div className="flex min-h-dvh flex-col text-[14px]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-faint/50 px-3 py-2 sm:gap-x-4 sm:px-4">
        <Crumbs game={GAME} code={view.code} compact />
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${mine.impostor ? "bg-[#e03131]/15 text-[#e03131]" : "bg-[#15aabf]/15 text-[#0c8599] dark:text-[#66d9e8]"}`}>
          {mine.impostor ? "impostor" : "crewmate"}
          {mine.alive ? "" : " · ghost"}
        </span>
        <TaskBar done={game.tasks.done} total={game.tasks.total} className="order-last basis-full sm:order-none sm:basis-auto sm:flex-1" />
        <span className="flex-1 sm:hidden" />
        <Leave game={GAME} client={client} label="leave" />
      </header>

      {sabotage && (
        <div role="alert" className="animate-pulse bg-[#e03131] px-4 py-2 text-center text-[14px] font-semibold text-white">
          {sabotage.kind === "reactor"
            ? `reactor meltdown in ${until(sabotage.ends, now)}s! two of you to the reactor, hands on the scanners (${sabotage.hands}/${REACTOR_HANDS})`
            : "the lights are out! fix them in electrical"}
        </div>
      )}

      <main className="mx-auto grid w-full max-w-[74rem] flex-1 content-start gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="min-w-0 lg:col-start-1">
          <div className={`rounded-2xl border border-faint/60 p-2 transition-colors ${mine.dark ? "bg-[#101114]" : ""}`}>
            <Ship self={me} me={mine} players={players} sabotage={sabotage} ready={ready} dark={mine.dark} onMove={(to, vent) => void client.move(to, vent)} />
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted">
            {mine.alive ? "tap a room next to yours to go there." : "you're a ghost: go anywhere, and nobody alive can see you."}
            {mine.impostor && mine.alive ? " dashed lines are vents." : ""}
          </p>
        </section>
        <aside className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Here view={view} me={me} mine={mine} players={players} now={now} ready={ready} snapshot={snapshot} client={client} onTask={openTask} onLights={() => setOpen({ kind: "lights", seed: randomId(8) })} />
          <ErrorLine snapshot={snapshot} client={client} />
        </aside>
        <div className="min-w-0 lg:col-start-1">
          <MyTasks mine={mine} finished={finished} />
        </div>
      </main>

      {open && (
        <Modal title={open.kind === "task" ? open.task.name : "fix lights"} onClose={() => setOpen(null)}>
          {open.kind === "task" ? (
            <TaskGame task={open.task} seed={open.seed} opened={open.opened} impostor={mine.impostor} onDone={() => void taskDone(open.task)} />
          ) : (
            <Switches
              seed={open.seed}
              onDone={() => {
                void client.fix("lights");
                setOpen(null);
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()} className="w-full max-w-[22rem] animate-pop rounded-2xl bg-[#1c1f24] p-4 text-white shadow-2xl">
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

function MyTasks({ mine, finished }: { mine: Mine; finished: string | null }) {
  const tasks = mine.tasks.map((t) => ({ ...t, task: TASK_BY_ID.get(t.id)! }));
  return (
    <section aria-labelledby="tasks">
      <h2 id="tasks" className="text-[13px] text-muted">
        {mine.impostor ? "fake tasks: be seen doing these" : mine.alive ? "your tasks" : "your tasks: ghosts can still do them"}
      </h2>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {tasks.map(({ id, done, task }) => (
          <li
            key={id}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] ${done ? "bg-[#d3f9d8] text-[#2b8a3e] dark:bg-[#1f3d25] dark:text-[#8ce99a]" : "bg-ink/[0.04]"} ${finished === id ? "animate-pop" : ""}`}
          >
            <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${done ? "bg-[#2b8a3e] text-white" : "bg-[#f5c000] text-[#15171a]"}`}>
              {done ? "✓" : "!"}
            </span>
            <span className="min-w-0 flex-1 truncate">{task.name}</span>
            <span className="text-[12px] text-muted">{ROOMS[task.room].name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The room you're in: who's here, what's here, and what you can do about it. */
function Here({
  view,
  me,
  mine,
  players,
  now,
  ready,
  snapshot,
  client,
  onTask,
  onLights,
}: {
  view: SusView;
  me: string;
  mine: Mine;
  players: Map<string, PlayerView>;
  now: number;
  ready: boolean;
  snapshot: Snapshot;
  client: SusClient;
  onTask: (task: Task) => void;
  onLights: () => void;
}) {
  const game = view.game!;
  const room = mine.room;
  const sabotage = game.sabotage;
  const killIn = until(mine.killAt, now);
  const sabotageIn = until(mine.sabotageAt, now);
  const buttonIn = until(game.buttonAt, now);
  const mates = new Set(mine.mates);
  const busy = snapshot.busy;
  const tasksHere = mine.tasks.filter((t) => !t.done && TASK_BY_ID.get(t.id)!.room === room).map((t) => TASK_BY_ID.get(t.id)!);
  const person = (id: string) => players.get(id);

  return (
    <div className="rounded-2xl border border-faint/60 p-3.5">
      <p className="text-[12px] text-muted">you&rsquo;re in</p>
      <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{ROOMS[room].name}</h1>

      {mine.seen.length > 0 && (
        <ul className="mt-3 space-y-1">
          {mine.seen.map((note) => (
            <li key={`${note.t}:${note.kind}:${note.who}`} className="animate-pop rounded-lg bg-[#e03131]/10 px-2.5 py-1.5 text-[13px] font-medium text-[#e03131]">
              {seenLine(note, players, me)}
            </li>
          ))}
        </ul>
      )}
      {!mine.alive && mine.killer && <p className="mt-3 rounded-lg bg-ink/[0.05] px-2.5 py-1.5 text-[13px]">{nameOf(players, mine.killer, me)} killed you. nobody alive can hear you now.</p>}

      <section aria-label="who's here" className="mt-3">
        {mine.dark ? (
          <p className="rounded-lg bg-[#101114] px-3 py-2.5 text-[13px] text-white/80">it&rsquo;s too dark to see who&rsquo;s in here.</p>
        ) : mine.here.length === 0 && mine.bodies.length === 0 ? (
          <p className="text-[13px] text-muted">nobody else is here.</p>
        ) : null}
        <ul className="space-y-1.5">
          {mine.here.map((id) => {
            const p = person(id);
            if (!p) return null;
            const scanning = mine.scanning.includes(id);
            return (
              <li key={id} className="flex items-center gap-2.5">
                <Bean color={p.color} className="size-8 shrink-0" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-medium">{p.name}</span>
                  {scanning && <span className="block text-[12px] text-[#2b8a3e] dark:text-[#8ce99a]">on the scanner: they&rsquo;re crew</span>}
                  {mates.has(id) && <span className="block text-[12px] text-[#e03131]">impostor, like you</span>}
                </span>
                {mine.impostor && mine.alive && !mates.has(id) && (
                  <button type="button" disabled={killIn > 0 || busy} onClick={() => void client.kill(id)} className={`min-h-9 rounded-lg px-3 text-[13px] font-bold ${RED}`}>
                    {killIn > 0 ? `kill (${killIn})` : "kill"}
                  </button>
                )}
              </li>
            );
          })}
          {mine.bodies.map((id) => {
            const p = person(id);
            return (
              <li key={`body:${id}`} className="flex items-center gap-2.5">
                <Bean color={p?.color ?? 0} dead className="size-8 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{id === me ? "your body" : `${nameOf(players, id, me)}’s body`}</span>
                {mine.alive && (
                  <button type="button" disabled={busy} onClick={() => void client.report(id)} className={`min-h-9 rounded-lg px-3 text-[13px] font-bold ${RED}`}>
                    report
                  </button>
                )}
              </li>
            );
          })}
          {mine.ghosts.map((id) => {
            const p = person(id);
            return (
              p && (
                <li key={`ghost:${id}`} className="flex items-center gap-2.5 text-muted">
                  <Bean color={p.color} ghost className="size-8 shrink-0" />
                  <span className="truncate">{p.name} (a ghost too)</span>
                </li>
              )
            );
          })}
        </ul>
      </section>

      <section aria-label="things to do" className="mt-4 space-y-2">
        {tasksHere.map((task) => (
          <button key={task.id} type="button" onClick={() => onTask(task)} className="flex min-h-10 w-full items-center justify-between rounded-lg bg-[#f5c000] px-3.5 text-[14px] font-semibold text-[#15171a] hover:bg-[#fcc419]">
            <span>{task.name}</span>
            <span className="text-[12px] font-medium opacity-70">{mine.impostor ? "pretend" : "do it"}</span>
          </button>
        ))}
        {room === SPOTS.button && mine.alive && (
          <button
            type="button"
            disabled={busy || mine.buttons <= 0 || buttonIn > 0 || sabotage?.kind === "reactor"}
            onClick={() => void client.button()}
            className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-[15px] font-bold ${RED}`}
          >
            <span>emergency meeting</span>
            <span className="text-[12px] font-medium opacity-90">
              {mine.buttons <= 0 ? "used" : buttonIn > 0 ? `in ${buttonIn}s` : `${mine.buttons}/${BUTTONS_EACH} left`}
            </span>
          </button>
        )}
        {room === SPOTS.table && <p className="rounded-lg bg-ink/[0.04] px-3 py-2 text-[13px] text-muted">the admin table shows how many are in each room, bodies and all: it&rsquo;s on the map.</p>}
        {mine.cameras && (
          <div className="rounded-lg bg-ink/[0.04] px-3 py-2">
            <p className="text-[13px] text-muted">the cameras:</p>
            <ul className="mt-1 space-y-1">
              {mine.cameras.map((cam) => (
                <li key={cam.room} className="flex flex-wrap items-center gap-1.5 text-[13px]">
                  <span className="w-24 shrink-0 font-medium">{ROOMS[cam.room].name}</span>
                  {cam.players.length + cam.bodies.length === 0 && <span className="text-muted">nobody</span>}
                  {cam.players.map((id) => (
                    <Bean key={id} color={person(id)?.color ?? 0} className="size-5" label={person(id)?.name} />
                  ))}
                  {cam.bodies.map((id) => (
                    <Bean key={`b${id}`} color={person(id)?.color ?? 0} dead className="size-5" label={`${person(id)?.name ?? "someone"}'s body`} />
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sabotage?.kind === "lights" && room === SPOTS.lights && mine.alive && (
          <button type="button" onClick={onLights} className={`min-h-10 w-full rounded-lg text-[14px] font-bold ${RED}`}>
            fix the lights
          </button>
        )}
        {sabotage?.kind === "reactor" && room === SPOTS.reactor && mine.alive && (
          <button type="button" disabled={mine.holding || busy} onClick={() => void client.fix("reactor")} className={`min-h-10 w-full rounded-lg text-[14px] font-bold ${RED}`}>
            {mine.holding ? `holding the scanner… (${sabotage.hands}/${REACTOR_HANDS})` : "put your hand on the scanner"}
          </button>
        )}
      </section>

      {mine.impostor && (
        <section aria-label="impostor" className="mt-4 rounded-xl border border-[#e03131]/30 p-2.5">
          {mine.alive && <p className="mb-2 text-[12.5px] text-muted">{killIn > 0 ? `you can kill again in ${killIn}s` : "you can kill: get someone alone"}</p>}
          {mine.alive && ventsFrom(room).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] text-muted">vent to</span>
              {ventsFrom(room).map((to) => (
                <Button key={to} disabled={!ready} onClick={() => void client.move(to, true)} className="min-h-8 border-[#e03131]/40 px-2.5 text-[12.5px]">
                  {ROOMS[to].name}
                </Button>
              ))}
            </div>
          )}
          <div className={`flex flex-wrap items-center gap-1.5 ${mine.alive && ventsFrom(room).length > 0 ? "mt-2" : ""}`}>
            <span className="text-[12.5px] text-muted">sabotage {sabotageIn > 0 && !sabotage ? `in ${sabotageIn}s` : ""}</span>
            {(["lights", "reactor"] as const).map((kind) => (
              <Button key={kind} disabled={!!sabotage || sabotageIn > 0 || busy} onClick={() => void client.sabotage(kind)} className="min-h-8 border-[#e03131]/40 px-2.5 text-[12.5px]">
                {kind}
              </Button>
            ))}
          </div>
        </section>
      )}

      {mine.alive && (
        <section aria-label="go to" className="mt-4">
          <p className="text-[12.5px] text-muted">go to {now < mine.moveAt ? "…" : ""}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {exitsFrom(room).map((to: RoomId) => (
              <Button key={to} disabled={!ready} onClick={() => void client.move(to)} className="min-h-9">
                {ROOMS[to].name}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
