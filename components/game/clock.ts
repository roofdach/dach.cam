"use client";

import { useEffect, useState } from "react";

/**
 * The server's clock, as seen from here. Multiplayer deadlines are stamped
 * by the server, and a laptop's clock can easily be a minute out, so every
 * reply that carries the server's time nudges an offset. The reply with the
 * quickest round trip is trusted most, the way NTP does it.
 */
let offset = 0;
let bestTrip = Infinity;
let samples = 0;

export function noteServerTime(serverNow: number, sentAt: number, receivedAt: number): void {
  if (!Number.isFinite(serverNow)) return;
  const trip = Math.max(0, receivedAt - sentAt);
  const estimate = serverNow - (sentAt + receivedAt) / 2;
  // A slow reply says little; but let the best trip age, so a better network later can still win.
  if (samples === 0 || trip <= bestTrip * 1.25) {
    offset = estimate;
    bestTrip = trip;
  } else {
    bestTrip *= 1.05;
  }
  samples++;
}

export function serverNow(): number {
  return Date.now() + offset;
}

/** Re-renders every `ms` with the server's time. */
export function useServerNow(ms = 250): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** Re-renders every `ms` with this machine's time. */
export function useLocalNow(ms = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
