"use client";

import { useEffect, useState } from "react";
import { subscribePresence } from "./client";
import type { LanyardConnectionState, LanyardData } from "./types";

export interface LanyardState {
  data: LanyardData | null;
  connection: LanyardConnectionState;
}

export function useLanyard(userId: string): LanyardState {
  const [state, setState] = useState<LanyardState>(() => ({
    data: null,
    connection: userId ? "connecting" : "failed",
  }));

  useEffect(() => {
    if (!userId) return;

    const subscription = subscribePresence(userId, {
      onData: (data) => setState({ data, connection: "live" }),
      onState: (connection) =>
        setState((prev) => (prev.connection === connection ? prev : { ...prev, connection })),
    });

    return () => subscription.close();
  }, [userId]);

  return state;
}
