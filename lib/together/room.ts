/**
 * The browser half of `together`. Reading is an event stream, writing is a
 * POST. Reconnection is left to EventSource, which is most of the reason for
 * choosing it — and because the server replies to every new stream with the
 * whole operation log, coming back after a dropout needs no special case.
 */

import type { ClientMessage, Peer, ServerEvent } from "./protocol";

export type { Cursor, Peer, ServerEvent } from "./protocol";
export { approach, randomPeer, PEER_COLORS } from "./protocol";

const ENDPOINT = "/api/together";

export type Connection = "connecting" | "open" | "offline";

export class Room {
  readonly name: string;
  readonly self: Peer;
  private source: EventSource | null = null;
  private onEvent: (event: ServerEvent) => void;
  private onConnection: (state: Connection) => void;
  private closed = false;

  constructor(
    name: string,
    self: Peer,
    handlers: { onEvent: (event: ServerEvent) => void; onConnection: (state: Connection) => void },
  ) {
    this.name = name;
    this.self = self;
    this.onEvent = handlers.onEvent;
    this.onConnection = handlers.onConnection;

    const query = new URLSearchParams({ room: name, id: self.id, name: self.name, color: self.color });
    const source = new EventSource(`${ENDPOINT}?${query}`);
    this.source = source;

    source.onopen = () => this.onConnection("open");
    source.onerror = () => this.onConnection(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    source.onmessage = (event) => {
      try {
        this.onEvent(JSON.parse(event.data) as ServerEvent);
      } catch {
        // A half-delivered frame is not worth taking the room down for.
      }
    };
  }

  /** Fire and forget: the stream, not the response, is what carries state. */
  send(message: ClientMessage) {
    if (this.closed) return;
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: this.name, id: this.self.id, message }),
      keepalive: true,
    }).catch(() => {
      // Offline is already visible through the event stream.
    });
  }

  close() {
    this.closed = true;
    this.source?.close();
    this.source = null;
  }
}
