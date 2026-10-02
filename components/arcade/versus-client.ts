"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ArcadeGame } from "@/lib/arcade/games";
import type { RoomView } from "@/lib/arcade/room";
import type { Live } from "@/lib/arcade/server/rooms";
import { noteServerTime, serverNow } from "@/components/game/clock";
import { KEYS, forget, isString, load, save } from "@/components/game/storage";

/**
 * One browser's line to an arcade versus room, the same way the other
 * rooms' work (see components/draw/room-client.ts): it polls the room,
 * which is the same for everyone so Vercel's CDN can share it, pings now
 * and then, and sends what you do. While a round's on, the game says how
 * far you've got a few times a second, signed with your seat's key, and
 * hears how far everyone else has (see lib/arcade/server/rooms.ts).
 */

interface Identity {
  id: string;
  token: string;
  /** What live updates are signed with; asked for again if it's missing. */
  key?: string;
}

const isIdentity = (value: unknown): value is Identity =>
  !!value && typeof value === "object" && isString((value as Identity).id) && isString((value as Identity).token);

export type RoomStatus = "connecting" | "ready" | "missing" | "unavailable" | "kicked";

export interface Snapshot {
  status: RoomStatus;
  view: RoomView | null;
  me: string | null;
  offline: boolean;
  error: string | null;
  busy: boolean;
}

const HIDDEN_POLL_MS = 15_000;
const PING_MS = 20_000;
const encoder = new TextEncoder();
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const toBase64 = (data: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(data)));

export class VersusClient {
  readonly game: ArcadeGame;
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
  private askedAt = 0;
  private signer: { key: string; hmac: Promise<CryptoKey> } | null = null;

  constructor(game: ArcadeGame, code: string) {
    this.game = game;
    this.code = code;
    this.identity = load(KEYS.arcadeRoom(game, code), isIdentity);
    this.snapshot = { status: "connecting", view: null, me: this.identity?.id ?? null, offline: false, error: null, busy: false };
  }

  private get api() {
    return `/api/${this.game}/rooms/${this.code}`;
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

  /** Every second while a round's on, to see who's finished; just after the countdown ends. */
  private delay(): number {
    if (document.visibilityState !== "visible") return HIDDEN_POLL_MS;
    const view = this.snapshot.view;
    if (!view || view.phase === "lobby" || view.phase === "over" || view.phase === "results") return 2000;
    if (view.phase === "countdown") return Math.min(1000, Math.max(200, view.match!.round.startAt - serverNow() + 150));
    return 1000;
  }

  private schedule(sentAt: number) {
    if (!this.running) return;
    clearTimeout(this.pollTimer);
    const base = this.delay();
    // Include the request in the cadence; retain full delays when hidden or retrying.
    const wait = document.visibilityState === "visible" ? Math.max(100, base - Math.max(0, Date.now() - sentAt)) : base;
    this.pollTimer = setTimeout(() => void this.poll(), this.failures ? Math.min(15_000, base * 2 ** this.failures) : wait);
  }

  private async poll() {
    if (!this.running) return;
    const sentAt = Date.now();
    try {
      const response = await fetch(this.api, { headers: { Accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as (RoomView & { error?: string }) | null;
      if (response.status === 404) return this.set({ status: "missing" });
      if (response.status === 503) return this.set({ status: "unavailable" });
      if (!response.ok || !body) throw new Error(body?.error ?? `HTTP ${response.status}`);
      this.failures = 0;
      if (this.snapshot.offline) this.set({ offline: false });
      this.accept(body, sentAt, Date.now(), !this.synced);
    } catch {
      this.failures++;
      if (this.failures >= 3 && !this.snapshot.offline) this.set({ offline: true });
    } finally {
      if (this.snapshot.status !== "missing" && this.snapshot.status !== "unavailable") this.schedule(sentAt);
    }
  }

  private accept(view: RoomView, sentAt: number, receivedAt: number, clock: boolean) {
    if (clock) {
      noteServerTime(view.now, sentAt, receivedAt);
      this.synced = true;
    }
    const latest = this.latest;
    if (view.version < latest.version || (view.version === latest.version && view.now < latest.now)) return;
    this.latest = { version: view.version, now: view.now };
    const key = JSON.stringify({ ...view, now: 0 });
    if (key !== this.viewKey || this.snapshot.status !== "ready") {
      this.viewKey = key;
      this.set({ status: "ready", view });
    }
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

  private async post(body: Record<string, unknown>) {
    const sentAt = Date.now();
    const response = await fetch(this.api, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null, sentAt };
  }

  private absorb(body: Record<string, unknown>, sentAt: number) {
    if (isString(body.key) && this.identity && this.identity.key !== body.key) {
      this.identity = { ...this.identity, key: body.key };
      save(KEYS.arcadeRoom(this.game, this.code), this.identity);
    }
    if (body.room) this.accept(body.room as RoomView, sentAt, Date.now(), true);
  }

  private forgetSeat() {
    this.identity = null;
    forget(KEYS.arcadeRoom(this.game, this.code));
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
        this.identity = { ...you, key: isString(reply.body?.key) ? reply.body.key : undefined };
        save(KEYS.arcadeRoom(this.game, this.code), this.identity);
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

  async act(type: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    this.set({ busy: true, error: null });
    try {
      return (await this.request({ ...payload, type }, true)) !== null;
    } finally {
      this.set({ busy: false });
    }
  }

  /** Your run this round, for the server to play back. */
  finish(moves: unknown) {
    const match = this.snapshot.view?.match;
    if (!match) return Promise.resolve(false);
    return this.act("finish", { match: match.index, round: match.round.index, moves });
  }

  /** Says how far you've got, signed, and hears how far everyone else has; null if it didn't get through. */
  async live(data: string): Promise<Record<string, Live> | null> {
    const identity = this.identity;
    if (!identity || !this.running) return null;
    if (!identity.key) {
      if (Date.now() - this.askedAt > 4000) {
        this.askedAt = Date.now();
        void this.request({ type: "me" });
      }
      return null;
    }
    if (this.signer?.key !== identity.key) {
      this.signer = { key: identity.key, hmac: crypto.subtle.importKey("raw", fromBase64(identity.key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) };
    }
    const mac = toBase64(await crypto.subtle.sign("HMAC", await this.signer.hmac, encoder.encode(`live\n${identity.id}\n${data}`)));
    try {
      const reply = await this.post({ type: "live", player: identity.id, data, mac });
      if (!reply.ok || !reply.body || typeof reply.body.now !== "number") return null;
      noteServerTime(reply.body.now, reply.sentAt, Date.now());
      return (reply.body.live as Record<string, Live>) ?? {};
    } catch {
      return null;
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

export function useVersusRoom(game: ArcadeGame, code: string): [Snapshot, VersusClient] {
  const [client] = useState(() => new VersusClient(game, code));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return [snapshot, client];
}
