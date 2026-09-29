"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { unseal } from "@/lib/draw/secret";
import type { Sabotage } from "@/lib/sus/room";
import type { Mine, Position, SusView } from "@/lib/sus/server/rooms";
import type { ZoneId } from "@/lib/sus/ship";
import { noteServerTime, serverNow } from "@/components/game/clock";
import { KEYS, forget, isString, load, save } from "@/components/game/storage";

/**
 * One browser's line to an among us room, the same way the other rooms'
 * work (see components/draw/room-client.ts): it polls the room, which is the
 * same for everyone so Vercel's CDN can share it, pings now and then, and
 * sends what you do. Your own view, who you are and what you can see, comes
 * sealed in the room with everyone else's (see lib/sus/server/rooms.ts), and
 * this opens yours with the key you were given when you sat down. The same
 * key signs where you're standing, which goes several times a second while
 * you walk about (see ./engine.ts).
 */

interface Identity {
  id: string;
  token: string;
  /** What your view is sealed with; asked for again if it's missing. */
  key?: string;
}

const isIdentity = (value: unknown): value is Identity =>
  !!value && typeof value === "object" && isString((value as Identity).id) && isString((value as Identity).token);

export type RoomStatus = "connecting" | "ready" | "missing" | "unavailable" | "kicked";

export interface Snapshot {
  status: RoomStatus;
  view: SusView | null;
  me: string | null;
  /** Your own view, once it's opened; null when you're not in the game that's on. */
  mine: Mine | null;
  offline: boolean;
  error: string | null;
  busy: boolean;
}

const HIDDEN_POLL_MS = 15_000;
const PING_MS = 20_000;

const encoder = new TextEncoder();
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const toBase64 = (data: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(data)));

/** What a position request hears back: everyone else's, and the room's version when something last happened. */
export interface Positions {
  now: number;
  pos: Record<string, Position>;
  version: number;
}

export class SusClient {
  readonly code: string;
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private identity: Identity | null;
  private viewKey = "";
  private latest = { version: -1, now: 0 };
  /** Counts up with every room taken in, so a slow unsealing can't show an older one over a newer. */
  private ticket = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private failures = 0;
  private rejoining = false;
  private leaving = false;
  private synced = false;
  private askedAt = 0;
  /** The key positions are signed with, made from the seat key once. */
  private signer: { key: string; hmac: Promise<CryptoKey> } | null = null;

  constructor(code: string) {
    this.code = code;
    this.identity = load(KEYS.susRoom(code), isIdentity);
    this.snapshot = { status: "connecting", view: null, me: this.identity?.id ?? null, mine: null, offline: false, error: null, busy: false };
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

  /** Every second while anything's happening, to see who walks in; just after anything falls due. */
  private delay(): number {
    if (document.visibilityState !== "visible") return HIDDEN_POLL_MS;
    const game = this.snapshot.view?.game;
    if (!game || game.phase === "over") return 2000;
    if (game.phase === "action" || game.phase === "meeting") return 1000;
    const until = game.ends - serverNow();
    return Math.min(1500, until > 0 ? until + 250 : 600);
  }

  private schedule() {
    if (!this.running) return;
    clearTimeout(this.pollTimer);
    const base = this.delay();
    this.pollTimer = setTimeout(() => void this.poll(), this.failures ? Math.min(15_000, base * 2 ** this.failures) : base);
  }

  /** Asks for the room; with a version, one the CDN can't have kept from before it (everyone asking for the same one shares it). */
  private async poll(version?: number) {
    if (!this.running) return;
    const sentAt = Date.now();
    try {
      const response = await fetch(`/api/sus/rooms/${this.code}${version ? `?v=${version}` : ""}`, { headers: { Accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as (SusView & { error?: string }) | null;
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
      if (this.snapshot.status !== "missing" && this.snapshot.status !== "unavailable") this.schedule();
    }
  }

  /** Takes in a room, with your view if it came along in the clear (a reply to you), or opens it from the room's seals. */
  private accept(view: SusView, sentAt: number, receivedAt: number, clock: boolean, mine?: Mine | null) {
    if (clock) {
      noteServerTime(view.now, sentAt, receivedAt);
      this.synced = true;
    }
    const latest = this.latest;
    if (view.version < latest.version || (view.version === latest.version && view.now < latest.now)) return;
    this.latest = { version: view.version, now: view.now };
    const ticket = ++this.ticket;
    if (mine !== undefined) return this.show(view, mine);
    void this.open(view).then((opened) => {
      if (ticket === this.ticket) this.show(view, opened === undefined ? this.snapshot.mine : opened);
    });
  }

  /** Your view from the room's seals: null if you're not in this game, undefined if it couldn't be opened here. */
  private async open(view: SusView): Promise<Mine | null | undefined> {
    const me = this.snapshot.me;
    const sealed = me ? view.seals[me] : undefined;
    if (!me || !sealed) return null;
    const key = this.identity?.key;
    const text = key ? await unseal(key, sealed.iv, sealed.box) : null;
    if (text === null) {
      this.askForKey();
      return undefined;
    }
    try {
      return JSON.parse(text) as Mine;
    } catch {
      return undefined;
    }
  }

  private askForKey() {
    if (!this.identity || Date.now() - this.askedAt < 4000) return;
    this.askedAt = Date.now();
    void this.request({ type: "me" });
  }

  private show(view: SusView, mine: Mine | null) {
    const key = JSON.stringify({ ...view, now: 0, seals: null }) + JSON.stringify(mine);
    if (key !== this.viewKey || this.snapshot.status !== "ready") {
      this.viewKey = key;
      this.set({ status: "ready", view, mine });
    }
    this.checkSeat(view);
  }

  /** If the room let you go while you were away, take your seat again. */
  private checkSeat(view: SusView) {
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
    const response = await fetch(`/api/sus/rooms/${this.code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null, sentAt };
  }

  private absorb(body: Record<string, unknown>, sentAt: number) {
    if (isString(body.key) && this.identity && this.identity.key !== body.key) {
      this.identity = { ...this.identity, key: body.key };
      save(KEYS.susRoom(this.code), this.identity);
    }
    if (body.room) this.accept(body.room as SusView, sentAt, Date.now(), true, "mine" in body ? ((body.mine as Mine | null) ?? null) : undefined);
  }

  private forgetSeat() {
    this.identity = null;
    forget(KEYS.susRoom(this.code));
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
        this.identity = { ...you, key: isString(reply.body?.key) ? reply.body.key : undefined };
        save(KEYS.susRoom(this.code), this.identity);
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

  private get game() {
    return this.snapshot.view?.game?.index ?? 0;
  }

  /** Says you've walked into another zone: quietly, since the next step will say it again if this one didn't take. */
  zone = (zone: ZoneId) => this.request({ type: "zone", game: this.game, zone });
  vent = (from: string, to: string) => this.act("vent", { game: this.game, from, to });
  task = (task: string) => this.act("task", { game: this.game, task });
  begin = (task: string) => this.act("begin", { game: this.game, task });
  kill = (target: string, x: number, y: number) => this.act("kill", { game: this.game, target, x, y });
  report = (body: string) => this.act("report", { game: this.game, body });
  button = () => this.act("button", { game: this.game });
  sabotage = (kind: Sabotage) => this.act("sabotage", { game: this.game, kind });
  fix = (kind: Sabotage) => this.act("fix", { game: this.game, kind });
  vote = (target: string) => this.act("vote", { game: this.game, meeting: this.snapshot.view?.game?.meeting?.index ?? 0, for: target });

  /** A line at a meeting. It doesn't hold anything else up. */
  async say(text: string): Promise<boolean> {
    return (await this.request({ type: "say", text }, true)) !== null;
  }

  /**
   * Says where you are, signed with your seat's key, and hears where
   * everyone else is. If something's happened since the room you have, a
   * kill or a meeting, the room's fetched at once.
   */
  async position(where: { x: number; y: number; f: number; m: number; v: number }): Promise<Positions | null> {
    const identity = this.identity;
    if (!identity?.key || !this.running) return null;
    if (this.signer?.key !== identity.key) {
      this.signer = { key: identity.key, hmac: crypto.subtle.importKey("raw", fromBase64(identity.key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) };
    }
    const data = JSON.stringify(where);
    const mac = toBase64(await crypto.subtle.sign("HMAC", await this.signer.hmac, encoder.encode(`pos\n${identity.id}\n${data}`)));
    try {
      const reply = await this.post({ type: "pos", player: identity.id, data, mac });
      const body = reply.body as (Positions & { error?: string }) | null;
      if (!reply.ok || !body || typeof body.now !== "number") {
        if (reply.status === 401) this.askForKey();
        return null;
      }
      noteServerTime(body.now, reply.sentAt, Date.now());
      if (body.version > this.latest.version && this.running) {
        clearTimeout(this.pollTimer);
        void this.poll(body.version);
      }
      return body;
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

export function useSusRoom(code: string): [Snapshot, SusClient] {
  const [client] = useState(() => new SusClient(code));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return [snapshot, client];
}
