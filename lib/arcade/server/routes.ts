/**
 * The HTTP side of each arcade game's API, the same for both: its routes
 * under app/api/flap and app/api/snake are one line each.
 */

import { NOT_SET_UP, failure, fresh, readBody, shared } from "../../rooms/http.ts";
import { storeFromEnv } from "../../rooms/store.ts";
import type { ArcadeGame } from "../games.ts";
import type { VersusEvent } from "../room.ts";
import { scoresFromEnv } from "../scores.ts";
import { act, createRoom, getRoom, live, ping } from "./rooms.ts";
import { getBoards, issueTicket, submitRun, ticketSecret } from "./scores.ts";

type Context = { params: Promise<{ code: string }> };

const typeOf = (body: unknown) => (typeof body === "object" && body !== null ? (body as { type?: unknown }).type : undefined);

/** /api/GAME/rooms: makes a versus room, with whoever asked as its first player and host. */
export function roomsRoute(game: ArcadeGame) {
  return {
    async POST(request: Request) {
      const store = storeFromEnv<VersusEvent>(game);
      if (!store) return fresh({ error: NOT_SET_UP }, 503);
      try {
        return fresh(await createRoom(store, game, await readBody(request), Date.now()), 201);
      } catch (error) {
        return failure(error);
      }
    },
  };
}

/** /api/GAME/rooms/CODE: the room as everyone sees it, and anything a player does in it. */
export function roomRoute(game: ArcadeGame) {
  return {
    async GET(_request: Request, context: Context) {
      const store = storeFromEnv<VersusEvent>(game);
      if (!store) return fresh({ error: NOT_SET_UP }, 503);
      try {
        return shared(await getRoom(store, game, (await context.params).code, Date.now()));
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request: Request, context: Context) {
      const store = storeFromEnv<VersusEvent>(game);
      if (!store) return fresh({ error: NOT_SET_UP }, 503);
      try {
        const { code } = await context.params;
        const body = await readBody(request);
        const type = typeOf(body);
        // How far everyone's got comes several times a second, so it skips reading the room.
        if (type === "ping") return fresh(await ping(store, code, body, Date.now()));
        if (type === "live") return fresh(await live(store, game, code, body, Date.now()));
        return fresh(await act(store, game, code, body, Date.now()));
      } catch (error) {
        return failure(error);
      }
    },
  };
}

/** /api/GAME/scores: the boards, shared through the CDN for ten seconds; a ticket before a run, and the run after. */
export function scoresRoute(game: ArcadeGame) {
  return {
    async GET() {
      const store = scoresFromEnv();
      if (!store) return fresh({ error: NOT_SET_UP }, 503);
      try {
        return shared(await getBoards(store, game, Date.now()), 10);
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request: Request) {
      const store = scoresFromEnv();
      if (!store) return fresh({ error: NOT_SET_UP }, 503);
      try {
        const body = await readBody(request);
        const now = Date.now();
        if (typeOf(body) === "ticket") return fresh(await issueTicket(game, now, ticketSecret()));
        return fresh(await submitRun(store, game, body, now, ticketSecret()));
      } catch (error) {
        return failure(error);
      }
    },
  };
}
