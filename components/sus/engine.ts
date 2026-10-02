import { serverNow } from "@/components/game/clock";
import type { Mine, Position, SusView } from "@/lib/sus/server/rooms";
import { SEATS, SPOTS, TASK_BY_ID, VENTS, VENT_BY_ID, centerOf, hops, zoneAt, type Point, type Task, type Vent, type ZoneId } from "@/lib/sus/ship";
import { GHOST_SPEED, KILL_RANGE, REPORT_RANGE, SPEED, USE_RANGE, VISION, canSee, distance, fits, step } from "@/lib/sus/space";
import type { Positions, SusClient } from "./room-client";

/**
 * Walking about the ship, in one browser: your own crewmate, moved by the
 * keys or a thumb and stopped by the walls (see lib/sus/space.ts), and
 * everyone else's, drawn a moment behind where they said they were so they
 * glide between one word and the next. Where you are goes to the room
 * several times a second while you move, and hardly at all while you
 * stand still; which zone you're in goes too, whenever it changes, since
 * that's what the room checks a kill or a task against (see
 * lib/sus/room.ts). Nothing here is React: the game screen draws it
 * (./draw.ts) and asks what's in reach (see ./Play.tsx).
 */

/** Something you can use where you're standing. */
export type Target =
  | { kind: "task"; task: Task }
  | { kind: "button" }
  | { kind: "cameras" }
  | { kind: "admin" }
  | { kind: "lights" }
  | { kind: "reactor" }
  | { kind: "vent"; vent: Vent };

/** What you noticed since the last meeting, for the next one. */
export interface Note {
  t: number;
  kind: "vent-in" | "vent-out" | "body";
  /** Who: the one who vented, or whoever was by the body. */
  who: string[];
  /** Whose body. */
  whom?: string;
  zone: ZoneId;
}

/** What the buttons need to know; changes only when one of them should. */
export interface Hud {
  use: Target | null;
  /** The body you'd report. */
  report: string | null;
  /** Who you'd kill. */
  kill: string | null;
  vent: Vent | null;
  notes: Note[];
  /** Who killed you, for the moment it happens. */
  killedBy: string | null;
}

/** Someone else, as heard: where they said they were, and when. */
interface Sample {
  t: number;
  x: number;
  y: number;
  f: number;
  m: number;
  v: number;
}

export interface Shown extends Point {
  id: string;
  f: number;
  m: number;
  /** A ghost, which only other ghosts see. */
  ghost: boolean;
}

const WALK_POST_MS = 220;
const IDLE_POST_MS = 900;
const HISTORY_MS = 3000;
/** How far past the last word someone's guessed to have kept walking. */
const GUESS_MS = 140;
const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

const empty = (): Hud => ({ use: null, report: null, kill: null, vent: null, notes: [], killedBy: null });

export class Engine {
  private readonly client: SusClient;
  /** Where you are, and which way you face. */
  pos: Point = { ...SEATS[0] };
  facing = 1;
  moving = false;
  /** When you last moved, by this machine's clock. */
  private movedAt = 0;
  /** The vent you're hiding in, for an impostor. */
  inVent: Vent | null = null;

  view: SusView | null = null;
  mine: Mine | null = null;
  me = "";
  private round = "";
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private frozen = false;

  private peers = new Map<string, Sample[]>();
  /** Everyone else where they're drawn this frame, seen or not. */
  shown: Shown[] = [];
  /** Those of them you can see. */
  visible: Shown[] = [];
  private visibleAt: { t: number; who: Shown[] }[] = [];
  /** How late others' words have been arriving, lately; they're drawn that far behind. */
  private lags: number[] = [];
  private bodiesKnown = new Set<string>();
  private wasAlive = true;
  /** Vent puffs to draw, by this machine's clock. */
  puffs: { x: number; y: number; t: number }[] = [];

  private hud: Hud = empty();
  private hudKey = "";
  private listeners = new Set<() => void>();

  private attached = false;
  private postTimer: ReturnType<typeof setTimeout> | undefined;
  private zoneAsked = { zone: "", at: 0, busy: false };

  constructor(client: SusClient) {
    this.client = client;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getHud = () => this.hud;

  private setHud(patch: Partial<Hud>) {
    this.hud = { ...this.hud, ...patch };
    for (const listener of this.listeners) listener();
  }

  /* ------------------------------------------------------------- the room */

  get playing() {
    const game = this.view?.game;
    return !!game && game.phase === "action" && this.mine?.game === game.index;
  }

  get ghost() {
    return !!this.mine && !this.mine.alive;
  }

  /** How far you can see; a ghost sees everything. */
  get range() {
    const mine = this.mine;
    if (!mine || !mine.alive) return Infinity;
    return mine.impostor ? VISION.impostor : mine.dark ? VISION.dark : VISION.crew;
  }

  /** Takes in the room: puts you round the table when a round starts, and notices bodies and deaths. */
  sync(view: SusView, mine: Mine | null, me: string) {
    this.view = view;
    this.mine = mine;
    this.me = me;
    const game = view.game;
    if (!game || !mine || mine.game !== game.index) return;
    if (game.phase === "action") {
      const round = `${game.index}:${game.round}`;
      if (round !== this.round) this.startRound(round, view, mine, me);
      if (this.wasAlive && !mine.alive) {
        this.inVent = null;
        if (mine.killer) {
          this.setHud({ killedBy: mine.killer });
          setTimeout(() => this.setHud({ killedBy: null }), 2600);
        }
      }
      this.wasAlive = mine.alive;
      this.noticeBodies(mine);
    } else {
      this.inVent = null;
      this.keys.clear();
    }
  }

  private startRound(round: string, view: SusView, mine: Mine, me: string) {
    const fresh = this.round === "";
    this.round = round;
    this.peers.clear();
    this.shown = [];
    this.visible = [];
    this.visibleAt = [];
    this.bodiesKnown = new Set(mine.bodies.map((b) => b.victim));
    this.wasAlive = mine.alive;
    this.inVent = null;
    this.setHud({ ...empty(), notes: fresh ? this.hud.notes : [] });
    // After a reload, back where you were; otherwise round the table, or wherever the room last had you.
    const saved = fresh ? this.restore(round) : null;
    const seat = view.players.filter((p) => p.playing).findIndex((p) => p.id === me);
    const table = SEATS[Math.max(0, seat) % SEATS.length];
    const savedZone = saved && zoneAt(saved.x, saved.y);
    if (saved && (!mine.alive || (savedZone && hops(savedZone, mine.zone) <= 1))) this.pos = saved;
    else if (mine.zone === "cafeteria") this.pos = { ...table };
    else this.pos = centerOf(mine.zone);
    this.facing = this.pos.x > SPOTS.button.x ? -1 : 1;
  }

  private restore(round: string): Point | null {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`sus:pos:${this.client.code}`) ?? "null") as { round: string; x: number; y: number } | null;
      return saved && saved.round === round && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: saved.x, y: saved.y } : null;
    } catch {
      return null;
    }
  }

  private remember() {
    try {
      sessionStorage.setItem(`sus:pos:${this.client.code}`, JSON.stringify({ round: this.round, x: Math.round(this.pos.x), y: Math.round(this.pos.y) }));
    } catch {
      // Private browsing, say; a reload just starts you somewhere sensible.
    }
  }

  /** A body that turns up where you can see it: whoever was near it in the last few seconds gets remembered. */
  private noticeBodies(mine: Mine) {
    for (const body of mine.bodies) {
      if (this.bodiesKnown.has(body.victim)) continue;
      this.bodiesKnown.add(body.victim);
      // Impostors know well enough what happened.
      if (!mine.alive || mine.impostor || body.victim === this.me || !canSee(this.pos, body, this.range)) continue;
      const near = new Set<string>();
      const since = performance.now() - HISTORY_MS;
      for (const moment of this.visibleAt) {
        if (moment.t < since) continue;
        for (const p of moment.who) if (p.id !== body.victim && distance(p, body) < KILL_RANGE * 1.6) near.add(p.id);
      }
      this.note({ t: serverNow(), kind: "body", who: [...near], whom: body.victim, zone: zoneAt(body.x, body.y) ?? mine.zone });
    }
  }

  private note(note: Note) {
    this.setHud({ notes: [...this.hud.notes, note].slice(-8) });
  }

  /* ---------------------------------------------------------------- input */

  setStick(x: number, y: number) {
    this.stick = { x, y };
  }

  /** Whether you're watching the cameras, and so want to hear from everyone often. */
  private watching = false;

  setWatching(watching: boolean) {
    this.watching = watching;
  }

  /** Stops you walking while something's open over the ship. */
  setFrozen(frozen: boolean) {
    this.frozen = frozen;
    if (frozen) this.keys.clear();
  }

  private onKey = (event: KeyboardEvent) => {
    if (!(event.code in KEYS)) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    if (event.type === "keydown") {
      if (this.frozen || event.metaKey || event.ctrlKey || event.altKey) return;
      this.keys.add(event.code);
      event.preventDefault();
    } else this.keys.delete(event.code);
  };

  private onHide = () => {
    if (this.round) this.remember();
  };

  private onBlur = () => {
    this.keys.clear();
    this.stick = { x: 0, y: 0 };
  };

  private input(): Point {
    let x = this.stick.x;
    let y = this.stick.y;
    for (const code of this.keys) {
      x += KEYS[code][0];
      y += KEYS[code][1];
    }
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
  }

  /* ----------------------------------------------------------------- time */

  attach() {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("pagehide", this.onHide);
    void this.post();
  }

  detach() {
    this.attached = false;
    clearTimeout(this.postTimer);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("pagehide", this.onHide);
    this.keys.clear();
    this.stick = { x: 0, y: 0 };
    if (this.round) this.remember();
  }

  /** Moves you, and everyone else, on to now. */
  update(dt: number) {
    if (!this.playing) return;
    const mine = this.mine!;
    const now = performance.now();
    const wanted = this.frozen || this.inVent ? { x: 0, y: 0 } : this.input();
    const was = this.pos;
    if (wanted.x || wanted.y) {
      const speed = mine.alive ? SPEED : GHOST_SPEED;
      this.pos = step(this.pos, wanted.x * speed * dt, wanted.y * speed * dt, !mine.alive);
      if (Math.abs(wanted.x) > 0.2) this.facing = wanted.x > 0 ? 1 : -1;
    }
    const moved = distance(was, this.pos) > 0.01;
    if (moved) this.movedAt = now;
    const moving = moved;
    if (moving !== this.moving) this.kick();
    this.moving = moving;
    this.reportZone();
    this.follow(now);
    this.reach();
  }

  /** Tells the room when you've walked into another zone: one word at a time, and again if it didn't take. */
  private reportZone() {
    const mine = this.mine!;
    if (this.inVent) return;
    const zone = zoneAt(this.pos.x, this.pos.y);
    const asked = this.zoneAsked;
    if (!zone || zone === mine.zone || asked.busy) return;
    if (zone === asked.zone && performance.now() - asked.at < 800) return;
    this.zoneAsked = { zone, at: performance.now(), busy: true };
    void this.client.zone(zone).finally(() => (this.zoneAsked.busy = false));
  }

  /** Where everyone else is drawn: a little in the past, between the two words either side. */
  private follow(now: number) {
    const lag = this.lags.length ? Math.max(...this.lags) : 250;
    const at = serverNow() - Math.min(900, Math.max(220, lag + WALK_POST_MS * 0.6));
    const shown: Shown[] = [];
    const ghosts = new Set(this.ghost ? this.mine!.dead : []);
    for (const [id, samples] of this.peers) {
      const p = this.sampleAt(samples, at);
      if (p && (p.v === 0 || (p.v === 2 && ghosts.has(id)))) shown.push({ id, x: p.x, y: p.y, f: p.f, m: p.m, ghost: p.v === 2 });
    }
    this.shown = shown;
    const hidden = this.hiddenIds();
    const range = this.range;
    // A ghost sees everyone, through walls and all.
    this.visible = shown.filter((p) => (p.ghost || !hidden.has(p.id)) && (range === Infinity || canSee(this.pos, p, range)));
    const last = this.visibleAt.at(-1);
    if (!last || now - last.t > 200) {
      this.visibleAt.push({ t: now, who: this.visible });
      while (this.visibleAt.length && this.visibleAt[0].t < now - HISTORY_MS) this.visibleAt.shift();
    }
  }

  /** Who isn't drawn even when heard from: the dead, as far as you know, and whoever isn't in this game. */
  hiddenIds(): Set<string> {
    const hidden = new Set<string>();
    for (const p of this.view?.players ?? []) if (!p.playing || p.dead || p.id === this.me) hidden.add(p.id);
    for (const b of this.mine?.bodies ?? []) hidden.add(b.victim);
    return hidden;
  }

  private sampleAt(samples: Sample[], t: number): Sample | null {
    if (samples.length === 0) return null;
    if (t <= samples[0].t) return samples[0];
    for (let i = samples.length - 2; i >= 0; i--) {
      const a = samples[i];
      const b = samples[i + 1];
      if (a.t > t || b.t < t) continue;
      const k = (t - a.t) / Math.max(1, b.t - a.t);
      // A jump, out of a vent or onto someone, isn't walked.
      if (Math.hypot(b.x - a.x, b.y - a.y) > 400 || a.v !== b.v) return k < 0.5 ? a : b;
      return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, f: b.f, m: a.m || b.m, v: b.v };
    }
    const last = samples[samples.length - 1];
    const before = samples[samples.length - 2];
    if (!last.m || !before || last.v || before.v !== last.v || distance(before, last) > 400) return last;
    // A little past the last word, guess they kept going.
    const ahead = Math.min(GUESS_MS, t - last.t);
    const span = Math.max(1, last.t - before.t);
    const moved = step(last, ((last.x - before.x) / span) * ahead, ((last.y - before.y) / span) * ahead);
    return { ...last, ...moved };
  }

  /* ---------------------------------------------------------------- reach */

  /** What's within reach, for the buttons. */
  private reach() {
    const mine = this.mine!;
    const game = this.view!.game!;
    const alive = mine.alive;
    const me = this.pos;
    let use: Target | null = null;
    let best = Infinity;
    const consider = (target: Target, at: Point, range = USE_RANGE) => {
      const d = distance(me, at);
      if (d <= range && d < best && canSee(me, at, range + 1)) {
        use = target;
        best = d;
      }
    };
    if (!this.inVent) {
      if (!mine.impostor || alive) {
        for (const t of mine.tasks) {
          const task = TASK_BY_ID.get(t.id);
          if (task && !t.done) consider({ kind: "task", task }, task);
        }
      }
      if (alive) {
        consider({ kind: "button" }, SPOTS.button, USE_RANGE + 40);
        consider({ kind: "cameras" }, SPOTS.cameras);
        consider({ kind: "admin" }, SPOTS.table, USE_RANGE + 20);
        if (game.sabotage?.kind === "lights") consider({ kind: "lights" }, SPOTS.lights);
        if (game.sabotage?.kind === "reactor") for (const spot of SPOTS.reactor) consider({ kind: "reactor" }, spot);
      }
    }
    let vent: Vent | null = null;
    if (mine.impostor && alive && !this.inVent) {
      for (const v of VENTS) if (distance(me, v) <= USE_RANGE && (!vent || distance(me, v) < distance(me, vent))) vent = v;
    }
    let report: string | null = null;
    if (alive && !this.inVent) {
      let near = Infinity;
      for (const body of mine.bodies) {
        const d = distance(me, body);
        if (d <= REPORT_RANGE && d < near && canSee(me, body, REPORT_RANGE + 1)) [report, near] = [body.victim, d];
      }
    }
    let kill: string | null = null;
    if (mine.impostor && alive && !this.inVent) {
      const mates = new Set(mine.mates);
      let near = Infinity;
      for (const p of this.visible) {
        const d = distance(me, p);
        if (!mates.has(p.id) && d <= KILL_RANGE && d < near) [kill, near] = [p.id, d];
      }
    }
    const chosen = use as Target | null;
    const key = [chosen?.kind, chosen?.kind === "task" ? chosen.task.id : "", report, kill, vent?.id].join("|");
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.setHud({ use: chosen, report, kill, vent });
    }
  }

  /** Where someone's drawn, for the kill: the body goes where you saw them. */
  whereIs(id: string): Shown | null {
    return this.shown.find((p) => p.id === id) ?? null;
  }

  /** After a kill, you're where they were: just short, so the body isn't hidden under you. */
  jumpTo(p: Point) {
    const d = distance(this.pos, p);
    const short = d > 30 ? { x: p.x + ((this.pos.x - p.x) / d) * 30, y: p.y + ((this.pos.y - p.y) / d) * 30 } : this.pos;
    if (fits(short.x, short.y)) this.pos = short;
    this.kick();
  }

  /* ----------------------------------------------------------------- vents */

  enterVent(vent: Vent) {
    this.inVent = vent;
    this.pos = { x: vent.x, y: vent.y };
    this.puffs.push({ x: vent.x, y: vent.y, t: performance.now() });
    this.setHud({ vent: null, use: null, kill: null, report: null });
    this.hudKey = "";
    this.kick();
  }

  async ventTo(to: string): Promise<boolean> {
    const from = this.inVent;
    const next = VENT_BY_ID.get(to);
    if (!from || !next || !(await this.client.vent(from.id, to))) return false;
    if (this.inVent !== from) return false;
    this.inVent = next;
    this.pos = { x: next.x, y: next.y };
    this.kick();
    return true;
  }

  exitVent() {
    const vent = this.inVent;
    if (!vent) return;
    this.inVent = null;
    this.puffs.push({ x: vent.x, y: vent.y, t: performance.now() });
    this.kick();
  }

  /* ------------------------------------------------------------ the wire */

  /** Says where you are now rather than when the timer next comes round. */
  private kick() {
    if (!this.attached) return;
    clearTimeout(this.postTimer);
    this.postTimer = setTimeout(() => void this.post(), 0);
  }

  private posting = false;

  /** Says where you are and hears where everyone is; often while anyone in sight is walking, seldom when nobody is. */
  private async post() {
    if (!this.attached || this.posting) return;
    clearTimeout(this.postTimer);
    this.posting = true;
    const sentAt = performance.now();
    let busy = false;
    try {
      if (this.playing) {
        // A ghost says so, and nobody alive draws them.
        const v = this.ghost ? 2 : this.inVent ? 1 : 0;
        const reply = await this.client.position({ x: Math.round(this.pos.x), y: Math.round(this.pos.y), f: this.facing, m: this.moving ? 1 : 0, v });
        if (reply) this.take(reply);
        this.remember();
      }
      busy = this.watching || performance.now() - this.movedAt < 1000 || this.visible.some((p) => p.m);
      this.quick = busy;
    } finally {
      this.posting = false;
      if (this.attached) this.postTimer = setTimeout(() => void this.post(), Math.max(50, (busy ? WALK_POST_MS : IDLE_POST_MS) - (performance.now() - sentAt)));
    }
  }

  /** Whether the last word was asked for quickly, so how late it came says something. */
  private quick = false;

  private take(reply: Positions) {
    const now = reply.now;
    const seen = new Set<string>();
    for (const [id, p] of Object.entries(reply.pos)) {
      seen.add(id);
      const samples = this.peers.get(id) ?? [];
      const last = samples.at(-1);
      if (last && p.t <= last.t) continue;
      if (last && last.v + p.v === 1) this.noticeVent(id, p);
      samples.push({ t: p.t, x: p.x, y: p.y, f: p.f, m: p.m, v: p.v });
      while (samples.length > 2 && samples[0].t < now - HISTORY_MS) samples.shift();
      this.peers.set(id, samples);
      // Only walkers matter, and only when asking often: how far behind they need drawing.
      if (p.m && this.quick) this.lags.push(serverNow() - p.t);
    }
    for (const id of this.peers.keys()) if (!seen.has(id)) this.peers.delete(id);
    if (this.lags.length > 24) this.lags.splice(0, this.lags.length - 24);
  }

  /** Someone popping into or out of a vent where you can see. */
  private noticeVent(id: string, p: Position) {
    const mine = this.mine;
    if (!mine || this.hiddenIds().has(id) || !canSee(this.pos, p, this.range)) return;
    this.puffs.push({ x: p.x, y: p.y, t: performance.now() });
    if (mine.alive && !mine.mates.includes(id)) this.note({ t: serverNow(), kind: p.v ? "vent-in" : "vent-out", who: [id], zone: zoneAt(p.x, p.y) ?? mine.zone });
  }
}
