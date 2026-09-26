"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MAX_OPS_PER_BATCH, type Op } from "@/lib/draw/ink";
import type { DrawView, InkSlice, Said } from "@/lib/draw/server/rooms";
import { noteServerTime, serverNow } from "@/components/game/clock";
import { KEYS, forget, isString, load, save } from "@/components/game/storage";

/**
 * One browser's line to a drawing room, the same way geo's rooms work (see
 * components/geo/room-client.ts): it polls the room, which is the same for
 * everyone so Vercel's CDN can share it, pings now and then to say you're
 * still here, and sends what you do. On top of that it keeps the turn's
 * drawing as it comes in, sends yours if you're drawing, and asks the room
 * for what only you may know: the words on offer, the word once you've got it.
 */

export type View = Omit<DrawView, "ink">;

interface Identity {
  id: string;
  token: string;
}

const isIdentity = (value: unknown): value is Identity =>
  !!value && typeof value === "object" && isString((value as Identity).id) && isString((value as Identity).token);

/** What only you know, and which turn it's about, so last turn's word isn't taken for this one's. */
export interface Mine {
  turn: number | null;
  options: string[] | null;
  word: string | null;
  /** The host's own words, for the host. */
  words: string[] | null;
  /** Opens this turn's sealed chat, once you're drawing or have guessed (see lib/draw/secret.ts). */
  key: string | null;
}

/** A chat line only you see: your message on its way, or why it didn't go to everyone. */
export interface LocalLine {
  id: number;
  t: number;
  kind: "pending" | "close" | "hidden" | "failed";
  text: string;
}

export type RoomStatus = "connecting" | "ready" | "missing" | "unavailable" | "kicked";

export interface Snapshot {
  status: RoomStatus;
  view: View | null;
  me: string | null;
  mine: Mine | null;
  local: LocalLine[];
  /** The last few requests failed; still trying. */
  offline: boolean;
  /** Why the last thing you tried didn't work. */
  error: string | null;
  busy: boolean;
}

const HIDDEN_POLL_MS = 15_000;
const PING_MS = 20_000;
/**
 * Everyone asks for the drawing from a multiple of this many batches, so
 * players who are a batch or two apart still ask the same question and the
 * CDN can answer them all with one copy.
 */
const INK_BUCKET = 16;
/** Keeps a request well under the server's limit on size. */
const MAX_POINTS_PER_SEND = 1200;

/** The turn's drawing so far, batch by batch, as the room hands it out. */
export class InkBook {
  turn = -1;
  batches: Op[][] = [];
  /** Whether everything drawn so far has been read, or there was nothing to read. */
  synced = false;
  private listeners = new Set<() => void>();

  listen(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  /** A turn seen from its very start, so there's nothing to catch up on. */
  begin(turn: number) {
    if (turn <= this.turn) return;
    this.turn = turn;
    this.batches = [];
    this.synced = true;
    this.emit();
  }

  merge(slice: InkSlice) {
    if (slice.turn < this.turn) return;
    if (slice.turn > this.turn) {
      // A newer turn has to be read from its start.
      if (slice.from !== 0) return;
      this.turn = slice.turn;
      this.batches = [];
      this.synced = false;
    }
    let changed = !this.synced;
    this.synced = true;
    slice.batches.forEach((batch, i) => {
      if (slice.from + i !== this.batches.length) return;
      this.batches.push(batch);
      changed = true;
    });
    if (changed) this.emit();
  }
}

type SendResult = "ok" | "stop" | "retry";

/**
 * Sends the drawer's strokes one request at a time, so they arrive in order,
 * each request taking whatever has piled up since the last one went.
 */
export class InkSender {
  private pending: Op[] = [];
  private busy = false;
  private stopped = false;
  private failures = 0;
  private readonly post: (ops: Op[]) => Promise<SendResult>;

  constructor(post: (ops: Op[]) => Promise<SendResult>) {
    this.post = post;
  }

  add(op: Op) {
    if (!this.stopped) this.pending.push(op);
  }

  /** Everything handed over has gone, or never will. */
  get idle() {
    return !this.busy && (this.stopped || this.pending.length === 0);
  }

  private take(): Op[] {
    let points = 0;
    let count = 0;
    while (count < this.pending.length && count < MAX_OPS_PER_BATCH) {
      const op = this.pending[count];
      const size = op[0] === "l" ? (op.length - 4) / 2 : 1;
      if (count > 0 && points + size > MAX_POINTS_PER_SEND) break;
      points += size;
      count++;
    }
    return this.pending.splice(0, count);
  }

  async pump() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      while (this.pending.length > 0 && !this.stopped) {
        const batch = this.take();
        const result = await this.post(batch);
        if (result === "ok") {
          this.failures = 0;
        } else if (result === "stop") {
          this.stop();
        } else if (++this.failures > 5) {
          this.stop();
        } else {
          // Sent again as it was: a copy that did get through only draws the same thing twice.
          this.pending.unshift(...batch);
          await new Promise((resolve) => setTimeout(resolve, Math.min(4000, 300 * 2 ** this.failures)));
        }
      }
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.stopped = true;
    this.pending = [];
  }
}

export class DrawClient {
  readonly code: string;
  readonly ink = new InkBook();
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private identity: Identity | null;
  private viewKey = "";
  private latest = { version: -1, now: 0 };
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private failures = 0;
  private rejoining = false;
  private leaving = false;
  private synced = false;
  private asked = { key: "", at: 0 };
  private lineIds = 0;

  constructor(code: string) {
    this.code = code;
    this.identity = load(KEYS.drawRoom(code), isIdentity);
    this.snapshot = { status: "connecting", view: null, me: this.identity?.id ?? null, mine: null, local: [], offline: false, error: null, busy: false };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.pingTimer = setInterval(() => void this.ping(), PING_MS);
    void this.poll();
  }

  stop() {
    this.running = false;
    clearTimeout(this.pollTimer);
    clearInterval(this.pingTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = () => {
    if (document.visibilityState !== "visible" || !this.running) return;
    clearTimeout(this.pollTimer);
    void this.poll();
    void this.ping();
  };

  /** How long until the next poll: often while someone's drawing, and just after anything falls due. */
  private delay(): number {
    if (document.visibilityState !== "visible") return HIDDEN_POLL_MS;
    const game = this.snapshot.view?.game;
    // In the lobby and on the final scores the host can start at any moment.
    if (!game || !game.turn) return 2000;
    const turn = game.turn;
    // A drawing this browser hasn't started reading, after a reload or on arriving mid-turn: fetch it now.
    if (turn.phase !== "choosing" && this.ink.turn !== turn.id) return 150;
    // Whoever's drawing already has the drawing, and only needs the guesses.
    const drawer = turn.drawer === this.snapshot.me;
    const base = turn.phase === "drawing" ? (drawer ? 2000 : 1000) : turn.phase === "choosing" ? 1000 : 1500;
    const until = turn.ends - serverNow();
    // Overdue means the server hasn't caught up yet (or the CDN copy is a second old): ask again soon.
    return Math.min(base, until > 0 ? until + 250 : 600);
  }

  private schedule() {
    if (!this.running) return;
    clearTimeout(this.pollTimer);
    const base = this.delay();
    this.pollTimer = setTimeout(() => void this.poll(), this.failures ? Math.min(15_000, base * 2 ** this.failures) : base);
  }

  /**
   * The room, and the drawing from where this browser has got to. The drawer
   * asks too, though they have it: the same question as everyone else's gets
   * the CDN's shared answer rather than a trip to the database.
   */
  private url(): string {
    const base = `/api/draw/rooms/${this.code}`;
    const turn = this.snapshot.view?.game?.turn;
    if (!turn || turn.phase === "choosing") return base;
    const have = this.ink.turn === turn.id ? this.ink.batches.length : 0;
    return `${base}?ink=${turn.id}.${have - (have % INK_BUCKET)}`;
  }

  private async poll() {
    if (!this.running) return;
    const sentAt = Date.now();
    try {
      const response = await fetch(this.url(), { headers: { Accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as (DrawView & { error?: string }) | null;
      if (response.status === 404) return this.set({ status: "missing" });
      if (response.status === 503) return this.set({ status: "unavailable" });
      if (!response.ok || !body) throw new Error(body?.error ?? `HTTP ${response.status}`);
      this.failures = 0;
      if (this.snapshot.offline) this.set({ offline: false });
      // A reply from the CDN can be a second old, so it only sets the clock until a ping does better.
      this.accept(body, sentAt, Date.now(), !this.synced);
    } catch {
      this.failures++;
      if (this.failures >= 3 && !this.snapshot.offline) this.set({ offline: true });
    } finally {
      if (this.snapshot.status !== "missing" && this.snapshot.status !== "unavailable") this.schedule();
    }
  }

  private accept(body: DrawView, sentAt: number, receivedAt: number, clock: boolean) {
    if (clock) {
      noteServerTime(body.now, sentAt, receivedAt);
      this.synced = true;
    }
    const { ink, ...view } = body;
    if (ink) this.ink.merge(ink);
    const latest = this.latest;
    if (view.version < latest.version || (view.version === latest.version && view.now < latest.now)) return;
    this.latest = { version: view.version, now: view.now };
    // Most polls change nothing but the timestamp; don't redraw for those.
    const key = JSON.stringify({ ...view, now: 0 });
    if (key !== this.viewKey || this.snapshot.status !== "ready") {
      this.viewKey = key;
      this.set({ status: "ready", view });
    }
    const turn = view.game?.turn;
    if (turn && turn.drawer === this.snapshot.me && turn.phase === "choosing") this.ink.begin(turn.id);
    this.checkSeat(view);
    this.askMine(view);
  }

  /** What you need to know that the room can't tell everyone, if you don't have it yet. */
  private wanted(view: View): string | null {
    const me = this.snapshot.me;
    if (!me || !view.players.some((p) => p.id === me && p.active)) return null;
    const mine = this.snapshot.mine;
    const turn = view.game?.turn;
    if (turn && turn.drawer === me && turn.phase === "choosing") return mine?.turn === turn.id && mine.options ? null : `options:${turn.id}`;
    if (turn && turn.phase === "drawing" && (turn.drawer === me || turn.guessed.includes(me))) return mine?.turn === turn.id && mine.word ? null : `word:${turn.id}`;
    if ((!view.game || view.game.phase === "final") && view.host === me) return mine?.words ? null : "words";
    return null;
  }

  private askMine(view: View) {
    const key = this.wanted(view);
    if (!key || !this.identity) return;
    if (key === this.asked.key && Date.now() - this.asked.at < 4000) return;
    this.asked = { key, at: Date.now() };
    void this.request({ type: "me" });
  }

  /** If the room let you go while you were away, take your seat again. */
  private checkSeat(view: View) {
    const identity = this.identity;
    if (!identity || this.rejoining || this.leaving || this.snapshot.status === "kicked") return;
    if (view.players.some((p) => p.id === identity.id && p.active)) return;
    const name = load(KEYS.name, isString);
    if (!name) return;
    this.rejoining = true;
    void this.join(name).finally(() => (this.rejoining = false));
  }

  private async post(body: Record<string, unknown>) {
    const sentAt = Date.now();
    const response = await fetch(`/api/draw/rooms/${this.code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null, sentAt };
  }

  /** Takes in what a reply says: the room, and what only you may know. */
  private absorb(body: Record<string, unknown>, sentAt: number) {
    const room = body.room as DrawView | undefined;
    const mine = body.mine as Omit<Mine, "turn"> | undefined;
    if (mine && room) this.set({ mine: { ...mine, turn: room.game?.turn?.id ?? null } });
    if (room) this.accept(room, sentAt, Date.now(), true);
  }

  private forgetSeat() {
    this.identity = null;
    forget(KEYS.drawRoom(this.code));
    this.set({ me: null, mine: null });
  }

  /** Takes a seat, or takes your old one back. */
  async join(name: string): Promise<boolean> {
    this.set({ busy: true, error: null });
    try {
      const reply = await this.post({ type: "join", name, ...(this.identity ? { player: this.identity.id, token: this.identity.token } : {}) });
      if (!reply.ok) {
        if (reply.status === 403) {
          this.forgetSeat();
          this.set({ status: "kicked" });
        } else if (reply.status === 404) this.set({ status: "missing" });
        else if (reply.status === 503) this.set({ status: "unavailable" });
        else this.set({ error: String(reply.body?.error ?? "couldn't join") });
        return false;
      }
      const you = reply.body?.you;
      if (isIdentity(you)) {
        this.identity = you;
        save(KEYS.drawRoom(this.code), you);
        save(KEYS.name, name);
        this.set({ me: you.id });
      }
      this.absorb(reply.body!, reply.sentAt);
      return true;
    } catch {
      this.set({ error: "couldn't reach the server; check your connection" });
      return false;
    } finally {
      this.set({ busy: false });
    }
  }

  /** Sends something as you. Null if it didn't work; `error` says why, unless it was only asking. */
  private async request(payload: Record<string, unknown>, loud = false): Promise<Record<string, unknown> | null> {
    const identity = this.identity;
    if (!identity) return null;
    try {
      const reply = await this.post({ ...payload, player: identity.id, token: identity.token });
      if (!reply.ok) {
        if (reply.status === 401) this.forgetSeat();
        else if (reply.status === 403 && /removed/.test(String(reply.body?.error))) {
          this.forgetSeat();
          this.set({ status: "kicked" });
        } else if (reply.status === 404) this.set({ status: "missing" });
        if (loud) this.set({ error: String(reply.body?.error ?? "that didn't work") });
        return null;
      }
      this.absorb(reply.body!, reply.sentAt);
      return reply.body;
    } catch {
      if (loud) this.set({ error: "couldn't reach the server; check your connection" });
      return null;
    }
  }

  /** Does something in the room as you. Resolves false, with `error` set, if it didn't work. */
  async act(type: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    this.set({ busy: true, error: null });
    try {
      return (await this.request({ ...payload, type }, true)) !== null;
    } finally {
      this.set({ busy: false });
    }
  }

  /** Says something in the chat, which is a guess if you're guessing. */
  async say(text: string): Promise<Said | null> {
    const line: LocalLine = { id: ++this.lineIds, t: serverNow(), kind: "pending", text };
    this.set({ local: [...this.snapshot.local, line].slice(-30) });
    const reply = await this.request({ type: "say", text });
    const said = (reply?.said as Said | undefined) ?? null;
    // What everyone sees comes back in the room's chat; only what nobody else sees stays here.
    const kind = said === null ? "failed" : said === "close" || said === "hidden" ? said : null;
    this.set({ local: this.snapshot.local.flatMap((l) => (l.id !== line.id ? [l] : kind ? [{ ...l, kind }] : [])) });
    return said;
  }

  /** Posts a batch of your strokes; says whether to go on, try again, or give up. */
  async sendInk(turn: number, ops: Op[]): Promise<SendResult> {
    const identity = this.identity;
    if (!identity) return "stop";
    try {
      const reply = await this.post({ type: "ink", player: identity.id, token: identity.token, turn, ops });
      if (reply.ok) return "ok";
      return reply.status >= 500 || reply.status === 429 ? "retry" : "stop";
    } catch {
      return "retry";
    }
  }

  private async ping() {
    const identity = this.identity;
    if (!identity || !this.running) return;
    try {
      const reply = await this.post({ type: "ping", player: identity.id, token: identity.token });
      if (reply.ok && typeof reply.body?.now === "number") {
        noteServerTime(reply.body.now, reply.sentAt, Date.now());
        this.synced = true;
      }
    } catch {
      // The poll notices a dead connection; nothing to add here.
    }
  }

  /** Gives up your seat for good; the reply mustn't look like the room dropped you and prompt a rejoin. */
  async leave() {
    this.leaving = true;
    try {
      await this.act("leave");
    } finally {
      this.forgetSeat();
      this.leaving = false;
    }
  }

  clearError() {
    if (this.snapshot.error) this.set({ error: null });
  }
}

/** Connects to a room for as long as the component is mounted. */
export function useDrawRoom(code: string): [Snapshot, DrawClient] {
  const [client] = useState(() => new DrawClient(code));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return [snapshot, client];
}
