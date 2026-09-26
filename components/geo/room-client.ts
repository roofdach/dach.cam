"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { RoomView } from "@/lib/geo/room";
import { noteServerTime, serverNow } from "@/components/game/clock";
import { KEYS, forget, isString, load, save } from "@/components/game/storage";

/**
 * One browser's line to a room. It polls the room every couple of seconds,
 * and right after anything is due to happen, like a deadline; the reply is
 * the same for everyone, so Vercel's CDN can share it. It pings every twenty
 * seconds so the room knows you're still here, and sends whatever you do.
 * The views it hands out only ever move forward: a slow reply that arrives
 * after a newer one is dropped.
 */

interface Identity {
  id: string;
  token: string;
}

const isIdentity = (value: unknown): value is Identity =>
  !!value && typeof value === "object" && isString((value as Identity).id) && isString((value as Identity).token);

export type RoomStatus = "connecting" | "ready" | "missing" | "unavailable" | "kicked";

export interface RoomSnapshot {
  status: RoomStatus;
  view: RoomView | null;
  /** Your player id, if you have a seat in this room. */
  me: string | null;
  /** The last few requests failed; still trying. */
  offline: boolean;
  /** Why the last thing you tried didn't work. */
  error: string | null;
  busy: boolean;
}

const HIDDEN_POLL_MS = 15_000;
const PING_MS = 20_000;

export class RoomClient {
  readonly code: string;
  private snapshot: RoomSnapshot;
  private listeners = new Set<() => void>();
  private identity: Identity | null;
  private viewKey = "";
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private failures = 0;
  private rejoining = false;
  private leaving = false;
  private synced = false;

  constructor(code: string) {
    this.code = code;
    this.identity = load(KEYS.room(code), isIdentity);
    this.snapshot = { status: "connecting", view: null, me: this.identity?.id ?? null, offline: false, error: null, busy: false };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<RoomSnapshot>) {
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

  /** How long until the next poll: sooner while a round is on, and just after anything falls due. */
  private delay(): number {
    if (document.visibilityState !== "visible") return HIDDEN_POLL_MS;
    const game = this.snapshot.view?.game;
    // In the lobby and on the final scores the host can start at any moment, and the countdown is five seconds.
    if (!game) return 2000;
    const round = game.rounds[game.current];
    const due = game.phase === "countdown" ? round.start : game.phase === "playing" ? round.deadline : game.phase === "results" ? round.next : null;
    const base = game.phase === "final" ? 2500 : game.phase === "results" ? 3000 : 2000;
    if (due === null) return base;
    const until = due - serverNow();
    // Overdue means the server hasn't caught up yet (or the CDN copy is a second old): ask again soon.
    return Math.min(base, until > 0 ? until + 300 : 700);
  }

  private schedule() {
    if (!this.running) return;
    clearTimeout(this.pollTimer);
    const base = this.delay();
    this.pollTimer = setTimeout(() => void this.poll(), this.failures ? Math.min(15_000, base * 2 ** this.failures) : base);
  }

  private async poll() {
    if (!this.running) return;
    const sentAt = Date.now();
    try {
      const response = await fetch(`/api/geo/rooms/${this.code}`, { headers: { Accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as (RoomView & { error?: string }) | null;
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

  private accept(view: RoomView, sentAt: number, receivedAt: number, clock: boolean) {
    if (clock) {
      noteServerTime(view.now, sentAt, receivedAt);
      this.synced = true;
    }
    const current = this.snapshot.view;
    if (current && (view.version < current.version || (view.version === current.version && view.now < current.now))) return;
    // Most polls change nothing but the timestamp; don't redraw for those.
    const key = JSON.stringify({ ...view, now: 0 });
    if (key === this.viewKey && this.snapshot.status === "ready") return;
    this.viewKey = key;
    this.set({ status: "ready", view });
    this.checkSeat(view);
  }

  /** If the room let you go while you were away, take your seat again. */
  private checkSeat(view: RoomView) {
    const identity = this.identity;
    if (!identity || this.rejoining || this.leaving || this.snapshot.status === "kicked") return;
    if (view.players.some((p) => p.id === identity.id && p.active)) return;
    const name = load(KEYS.name, isString);
    if (!name) return;
    this.rejoining = true;
    void this.join(name).finally(() => (this.rejoining = false));
  }

  private async post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null; sentAt: number }> {
    const sentAt = Date.now();
    const response = await fetch(`/api/geo/rooms/${this.code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null, sentAt };
  }

  private forgetSeat() {
    this.identity = null;
    forget(KEYS.room(this.code));
    this.set({ me: null });
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
        save(KEYS.room(this.code), you);
        save(KEYS.name, name);
        this.set({ me: you.id });
      }
      this.accept(reply.body!.room as RoomView, reply.sentAt, Date.now(), true);
      return true;
    } catch {
      this.set({ error: "couldn't reach the server; check your connection" });
      return false;
    } finally {
      this.set({ busy: false });
    }
  }

  /** Does something in the room as you. Resolves false, with `error` set, if it didn't work. */
  async act(type: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    const identity = this.identity;
    if (!identity) return false;
    this.set({ busy: true, error: null });
    try {
      const reply = await this.post({ ...payload, type, player: identity.id, token: identity.token });
      if (!reply.ok) {
        if (reply.status === 401) this.forgetSeat();
        else if (reply.status === 403 && /removed/.test(String(reply.body?.error))) {
          this.forgetSeat();
          this.set({ status: "kicked" });
        } else if (reply.status === 404) this.set({ status: "missing" });
        this.set({ error: String(reply.body?.error ?? "that didn't work") });
        return false;
      }
      this.accept(reply.body!.room as RoomView, reply.sentAt, Date.now(), true);
      return true;
    } catch {
      this.set({ error: "couldn't reach the server; check your connection" });
      return false;
    } finally {
      this.set({ busy: false });
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
export function useRoom(code: string): [RoomSnapshot, RoomClient] {
  const [client] = useState(() => new RoomClient(code));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return [snapshot, client];
}
