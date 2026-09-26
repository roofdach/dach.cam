"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Op } from "@/lib/draw/ink";
import { GRACE_MS, type ChainView, type Entry } from "@/lib/phone/room";
import type { Mine, PhoneView } from "@/lib/phone/server/rooms";
import { noteServerTime, serverNow } from "@/components/game/clock";
import { KEYS, forget, isString, load, save } from "@/components/game/storage";

/**
 * One browser's line to a telephone room, the same way the drawing game's
 * works (see components/draw/room-client.ts): it polls the room, which is
 * the same for everyone so Vercel's CDN can share it, pings now and then,
 * and sends what you do. It also asks for what only you may see, your task
 * and what it carries on from, and once the chains are being shown, fetches
 * each one's work, a chain ahead of the one showing.
 */

export type View = Omit<PhoneView, "chain">;

interface Identity {
  id: string;
  token: string;
}

const isIdentity = (value: unknown): value is Identity =>
  !!value && typeof value === "object" && isString((value as Identity).id) && isString((value as Identity).token);

export type RoomStatus = "connecting" | "ready" | "missing" | "unavailable" | "kicked";

export interface Snapshot {
  status: RoomStatus;
  view: View | null;
  me: string | null;
  mine: Mine | null;
  /** Finished chains' work, by "GAME.CHAIN". */
  chains: Record<string, Entry[]>;
  offline: boolean;
  error: string | null;
  busy: boolean;
}

const HIDDEN_POLL_MS = 15_000;
const PING_MS = 20_000;

/** Which chain the reveal is on, from how many steps are showing. */
export function showing(album: ChainView[], shown: number): { chain: number; count: number } {
  let seen = 0;
  for (let chain = 0; chain < album.length; chain++) {
    const size = album[chain].entries.length;
    if (size === 0) continue;
    if (shown <= seen + size) return { chain, count: Math.max(0, shown - seen) };
    seen += size;
  }
  const last = album.findLastIndex((c) => c.entries.length > 0);
  return { chain: Math.max(0, last), count: last >= 0 ? album[last].entries.length : 0 };
}

export class PhoneClient {
  readonly code: string;
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

  constructor(code: string) {
    this.code = code;
    this.identity = load(KEYS.phoneRoom(code), isIdentity);
    this.snapshot = { status: "connecting", view: null, me: this.identity?.id ?? null, mine: null, chains: {}, offline: false, error: null, busy: false };
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

  /** How long until the next poll: often while the chains are being shown, and just after a step's time is up. */
  private delay(): number {
    if (document.visibilityState !== "visible") return HIDDEN_POLL_MS;
    const game = this.snapshot.view?.game;
    if (!game) return 2000;
    if (game.phase === "reveal") return this.wantedChain() === null ? 1000 : 150;
    const until = game.ends + GRACE_MS - serverNow();
    // Overdue means the server hasn't caught up yet (or the CDN copy is a second old): ask again soon.
    return Math.min(1500, until > 0 ? until + 250 : 600);
  }

  private schedule() {
    if (!this.running) return;
    clearTimeout(this.pollTimer);
    const base = this.delay();
    this.pollTimer = setTimeout(() => void this.poll(), this.failures ? Math.min(15_000, base * 2 ** this.failures) : base);
  }

  /** The chain whose work is needed next and isn't here yet: the one showing, then the one after. */
  private wantedChain(): string | null {
    const game = this.snapshot.view?.game;
    if (game?.phase !== "reveal" || !game.album) return null;
    const { chain } = showing(game.album, game.shown);
    for (const c of [chain, chain + 1]) {
      const key = `${game.index}.${c}`;
      if (c < game.album.length && game.album[c].entries.length > 0 && !this.snapshot.chains[key]) return key;
    }
    return null;
  }

  private url(): string {
    const base = `/api/phone/rooms/${this.code}`;
    const chain = this.wantedChain();
    return chain ? `${base}?chain=${chain}` : base;
  }

  private async poll() {
    if (!this.running) return;
    const sentAt = Date.now();
    try {
      const response = await fetch(this.url(), { headers: { Accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as (PhoneView & { error?: string }) | null;
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

  private accept(body: PhoneView, sentAt: number, receivedAt: number, clock: boolean) {
    if (clock) {
      noteServerTime(body.now, sentAt, receivedAt);
      this.synced = true;
    }
    const { chain, ...view } = body;
    if (chain && !this.snapshot.chains[`${chain.game}.${chain.chain}`]) {
      this.set({ chains: { ...this.snapshot.chains, [`${chain.game}.${chain.chain}`]: chain.entries } });
    }
    const latest = this.latest;
    if (view.version < latest.version || (view.version === latest.version && view.now < latest.now)) return;
    this.latest = { version: view.version, now: view.now };
    // Most polls change nothing but the timestamp; don't redraw for those.
    const key = JSON.stringify({ ...view, now: 0 });
    if (key !== this.viewKey || this.snapshot.status !== "ready") {
      this.viewKey = key;
      this.set({ status: "ready", view });
    }
    this.checkSeat(view);
    this.askMine(view);
  }

  /** Your task for this step, if you're playing and don't have it yet. */
  private askMine(view: View) {
    const me = this.snapshot.me;
    const game = view.game;
    if (!me || !this.identity || game?.phase !== "playing" || !game.order.includes(me)) return;
    if (!view.players.some((p) => p.id === me && p.active)) return;
    const mine = this.snapshot.mine;
    if (mine && mine.game === game.index && mine.step === game.step) return;
    const key = `${game.index}.${game.step}`;
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
    const response = await fetch(`/api/phone/rooms/${this.code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null, sentAt };
  }

  private absorb(body: Record<string, unknown>, sentAt: number) {
    const mine = body.mine as Mine | undefined;
    if (mine) this.set({ mine });
    if (body.room) this.accept(body.room as PhoneView, sentAt, Date.now(), true);
  }

  private forgetSeat() {
    this.identity = null;
    forget(KEYS.phoneRoom(this.code));
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
        save(KEYS.phoneRoom(this.code), you);
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

  /** Hands in this step's work: what you wrote, or what you drew. */
  submit(game: number, step: number, work: { text: string } | { ops: Op[] }) {
    return this.act("submit", { game, step, ...work });
  }

  /** The host shows the next step of the chains. */
  showNext() {
    const game = this.snapshot.view?.game;
    if (game?.phase !== "reveal") return Promise.resolve(false);
    return this.act("show", { game: game.index, n: game.shown + 1 });
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
export function usePhoneRoom(code: string): [Snapshot, PhoneClient] {
  const [client] = useState(() => new PhoneClient(code));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return [snapshot, client];
}
