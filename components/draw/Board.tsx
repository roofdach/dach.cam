"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Spinner } from "@/components/game/ui";
import { Painter, Pen, Replayer, Surface, Toolbar, useTools } from "@/components/game/sketch";
import { InkSender, type DrawClient } from "./room-client";

/** How often the stroke in progress is sent: each send is a request and a database write, and the replay smooths it out. */
const SEND_MS = 400;

/**
 * The board, with the drawer's tools under it: your own pen when it's your
 * turn, sending as you draw, or else the room's copy of the drawing played
 * back. `children` float over it: the word choice, the scores between
 * turns. Give it a new `key` for each turn.
 */
export function Board({
  client,
  turn,
  mine,
  drawing,
  children,
}: {
  client: DrawClient;
  /** Whose drawing: this turn's, or none for a blank board. */
  turn: number | null;
  /** It's your turn, so the drawing comes from your pen rather than the room. */
  mine: boolean;
  /** You can draw right now. */
  drawing: boolean;
  children?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pen = useRef<Pen | null>(null);
  const [ready, setReady] = useState(!mine);
  const [tools, pick] = useTools();

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const painter = new Painter(element);
    if (turn === null) return;
    const book = client.ink;

    if (mine) {
      const sender = new InkSender((ops) => client.sendInk(turn, ops));
      const own = new Pen(painter, sender);
      let restored = false;
      // A turn seen from its start has nothing to restore; after a reload, wait for what was drawn.
      const restore = () => {
        if (restored || book.turn !== turn || !book.synced) return;
        restored = true;
        own.restore(book.batches.flat());
        pen.current = own;
        setReady(true);
      };
      const unlisten = book.listen(restore);
      restore();
      const timer = setInterval(() => {
        own.cut();
        void sender.pump();
      }, SEND_MS);
      return () => {
        unlisten();
        clearInterval(timer);
        own.up();
        void sender.pump();
        pen.current = null;
      };
    }

    const replayer = new Replayer(painter);
    let seen = 0;
    const take = () => {
      if (book.turn !== turn || book.batches.length <= seen) return;
      const fresh = book.batches.slice(seen);
      // Arriving part way through, the drawing so far appears at once.
      const instant = seen === 0 && fresh.length > 4;
      seen = book.batches.length;
      replayer.add(fresh.flat(), instant);
    };
    const unlisten = book.listen(take);
    take();
    return () => {
      unlisten();
      replayer.dispose();
    };
  }, [client, turn, mine]);

  const live = drawing && ready;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Surface canvas={canvas} pen={pen} live={live} tools={tools} label={drawing ? "your drawing" : "the drawing"}>
        {mine && !ready && (
          <div className="absolute inset-0 grid place-items-center bg-white/70 text-[13px] text-neutral-600">
            <span>
              <Spinner className="mr-2" /> getting your drawing back…
            </span>
          </div>
        )}
        {children}
      </Surface>
      {/* Kept in place while others draw on a laptop, so the board doesn't change size between turns. */}
      <div className={mine && drawing ? "" : "hidden lg:invisible lg:block"} aria-hidden={!(mine && drawing)}>
        <Toolbar tools={tools} onPick={pick} onUndo={() => pen.current?.undo()} onClear={() => pen.current?.clear()} disabled={!live} />
      </div>
    </div>
  );
}
