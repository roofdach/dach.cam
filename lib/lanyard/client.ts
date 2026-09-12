import type {
  LanyardConnectionState,
  LanyardData,
  LanyardIncoming,
  LanyardRestResponse,
} from "./types";

const SOCKET_URL = "wss://api.lanyard.rest/socket";
const REST_URL = "https://api.lanyard.rest/v1/users";

const Op = { Event: 0, Hello: 1, Initialize: 2, Heartbeat: 3 } as const;

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1_000;

export interface LanyardSubscription {
  close: () => void;
}

export interface LanyardHandlers {
  onData: (data: LanyardData) => void;
  onState?: (state: LanyardConnectionState) => void;
}

export async function fetchPresence(userId: string): Promise<LanyardData | null> {
  try {
    const res = await fetch(`${REST_URL}/${userId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as LanyardRestResponse;
    return json.success && json.data ? json.data : null;
  } catch {
    return null;
  }
}

/**
 * Opens a Lanyard WebSocket subscription for one user. Reconnects with
 * backoff; after too many failures it falls back to a single REST fetch so
 * the page still gets something, then gives up quietly.
 */
export function subscribePresence(userId: string, handlers: LanyardHandlers): LanyardSubscription {
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let closed = false;
  let receivedData = false;

  const setState = (state: LanyardConnectionState) => handlers.onState?.(state);

  const clearTimers = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    heartbeat = null;
    reconnectTimer = null;
  };

  const giveUp = async () => {
    const data = await fetchPresence(userId);
    if (closed) return;
    if (data) {
      handlers.onData(data);
      setState("live");
    } else {
      setState("failed");
    }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    attempts += 1;
    if (attempts > MAX_RECONNECT_ATTEMPTS) {
      void giveUp();
      return;
    }
    const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** (attempts - 1), 15_000);
    reconnectTimer = setTimeout(connect, delay);
  };

  const connect = () => {
    if (closed || typeof WebSocket === "undefined") return;
    clearTimers();
    setState("connecting");

    try {
      socket = new WebSocket(SOCKET_URL);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.addEventListener("message", (event) => {
      let message: LanyardIncoming;
      try {
        message = JSON.parse(String(event.data)) as LanyardIncoming;
      } catch {
        return;
      }

      if (message.op === Op.Hello && "d" in message) {
        const interval = (message.d as { heartbeat_interval: number }).heartbeat_interval;
        socket?.send(JSON.stringify({ op: Op.Initialize, d: { subscribe_to_id: userId } }));
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ op: Op.Heartbeat }));
          }
        }, interval);
        return;
      }

      if (message.op === Op.Event && "t" in message) {
        if (message.t === "INIT_STATE" || message.t === "PRESENCE_UPDATE") {
          receivedData = true;
          attempts = 0;
          handlers.onData(message.d as LanyardData);
          setState("live");
        }
      }
    });

    socket.addEventListener("close", () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket?.close();
    });
  };

  connect();

  // If the socket never yields anything, don't leave the reader waiting.
  const firstDataTimer = setTimeout(() => {
    if (!closed && !receivedData) void giveUp();
  }, 6_000);

  return {
    close: () => {
      closed = true;
      clearTimers();
      clearTimeout(firstDataTimer);
      socket?.close();
      socket = null;
    },
  };
}
