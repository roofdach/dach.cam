/**
 * What the browser and the server say to each other in `together`. Shared by
 * both sides so a change to the wire format can only ever break the build,
 * never one half of the conversation.
 */

import type { Op } from "./doc";

export interface Peer {
  id: string;
  name: string;
  color: string;
  /** True for the simulated collaborators, so the ui can say so. */
  simulated?: boolean;
}

export interface Cursor {
  /** Fraction of the editor's width and height, so it survives a resize. */
  x: number;
  y: number;
  /** Caret offset in the document, or -1 when the peer isn't in the text. */
  caret: number;
}

/** Sent by a tab, over POST. */
export type ClientMessage =
  | { t: "ops"; from: string; ops: Op[] }
  | { t: "cursor"; from: string; cursor: Cursor }
  | { t: "title"; from: string; title: string }
  | { t: "joined"; peer: Peer }
  | { t: "left"; id: string };

/** Sent by the server, over the event stream. */
export type ServerEvent =
  | { t: "welcome"; peers: Peer[]; ops: Op[]; title: string }
  | { t: "joined"; peer: Peer }
  | { t: "left"; id: string }
  | { t: "ops"; from: string; ops: Op[] }
  | { t: "cursor"; from: string; cursor: Cursor }
  | { t: "title"; from: string; title: string }
  | { t: "full" };

export const PEER_COLORS = ["#3b6ea5", "#5b8a72", "#8a7d5c", "#8a5c7d", "#4f7f8a", "#9a6b3f"];

const ADJECTIVES = ["quiet", "steady", "bright", "narrow", "soft", "plain", "even", "warm", "low", "spare"];
const ANIMALS = ["heron", "otter", "marten", "swift", "hare", "wren", "vole", "pika", "shrike", "tern"];

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export function randomName(): string {
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}

export function randomPeer(): Peer {
  return { id: Math.random().toString(36).slice(2, 10), name: randomName(), color: pick(PEER_COLORS) };
}

/* -------------------------------------------------------------- validation */

export const LIMITS = {
  /** Longest room name, id, display name. */
  name: 40,
  /** Ops in a single message. A keystroke is one; a paste is a few hundred. */
  opsPerMessage: 2000,
  /** Characters in one insert op, and in the document title. */
  text: 4,
  title: 120,
  /** Fractional keys grow slowly, but not without bound. */
  key: 256,
  /** Rooms are in memory, so both of these are a ceiling on what one costs. */
  opsPerRoom: 200_000,
  peersPerRoom: 32,
  rooms: 200,
  body: 256 * 1024,
} as const;

const slug = (value: string, max: number) => value.replace(/[^\w -]/g, "").trim().slice(0, max);

export function cleanRoomName(value: string | null): string {
  return slug(value ?? "", LIMITS.name).toLowerCase() || "note";
}

/** Anything arriving from a browser is untrusted, peers included. */
export function cleanPeer(value: unknown): Peer | null {
  if (!value || typeof value !== "object") return null;
  const peer = value as Record<string, unknown>;
  const id = typeof peer.id === "string" ? slug(peer.id, LIMITS.name) : "";
  const name = typeof peer.name === "string" ? slug(peer.name, LIMITS.name) : "";
  if (!id || !name) return null;
  const color = typeof peer.color === "string" && /^#[0-9a-fA-F]{6}$/.test(peer.color) ? peer.color : PEER_COLORS[0];
  return { id, name, color, simulated: peer.simulated === true };
}

export function cleanOps(value: unknown): Op[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.opsPerMessage) return null;
  const out: Op[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const op = raw as Record<string, unknown>;
    if (typeof op.id !== "string" || !op.id || op.id.length > LIMITS.key) return null;
    if (op.t === "d") {
      out.push({ t: "d", id: op.id });
      continue;
    }
    if (op.t !== "i") return null;
    if (typeof op.pos !== "string" || !op.pos || op.pos.length > LIMITS.key) return null;
    if (typeof op.ch !== "string" || op.ch.length === 0 || op.ch.length > LIMITS.text) return null;
    out.push({ t: "i", id: op.id, pos: op.pos, ch: op.ch });
  }
  return out;
}

export function cleanCursor(value: unknown): Cursor | null {
  if (!value || typeof value !== "object") return null;
  const cursor = value as Record<string, unknown>;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (!finite(cursor.x) || !finite(cursor.y) || !finite(cursor.caret)) return null;
  const clamp = (n: number) => Math.max(-1, Math.min(2, n));
  return { x: clamp(cursor.x as number), y: clamp(cursor.y as number), caret: Math.trunc(cursor.caret as number) };
}

/**
 * Exponential smoothing towards a target. Frame-rate independent, which matters
 * because remote cursors arrive at whatever rate the network manages.
 */
export function approach(current: number, target: number, dt: number, halfLife = 0.08): number {
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}
