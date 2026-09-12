"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCopy, useElementSize } from "@/lib/hooks";
import { Doc, type Op } from "@/lib/together/doc";
import { approach, randomPeer, Room, type Connection, type Cursor, type Peer, type ServerEvent } from "@/lib/together/room";

const SEED_TEXT = `roadmap notes

everything in this document is stored as a list of characters, each carrying a key that sorts it between its neighbours. type anywhere and the change travels as two or three operations, never as the whole paragraph.

whoever else has this page open is editing the same copy as you.`;

/**
 * Every browser seeds from the same deterministic ops, so the starting document
 * has the same character ids everywhere and two people meeting don't end up
 * with two copies of it. Nothing about the seed is ever sent.
 */
const SEED_OPS: Op[] = (() => {
  const doc = new Doc("seed");
  doc.insertAt(0, SEED_TEXT);
  return doc.ops();
})();

const BOT_LINES = [
  "cursor interpolation feels right at about an 80ms half-life. slower reads as lag.",
  "renamed the activity feed to 'trail'. it reads better in a sidebar.",
  "a delete carries the id of a character, so it never needs an index to be right.",
  "note to self: presence belongs to the connection, not to a heartbeat.",
  "keys are strings, so ordering them is a string comparison and nothing else.",
];

const TICK_MS = 110;
const DRIFT_MS = 1900;

interface TrailEvent {
  id: number;
  who: string;
  color: string;
  what: string;
}

interface Bot extends Peer {
  line: number;
  typed: number;
  /** Ids of the characters this bot put in the document, so it can take them back. */
  ids: string[];
  phase: "typing" | "resting" | "clearing";
  wait: number;
}

function makeBot(): Bot {
  return {
    ...randomPeer(),
    simulated: true,
    line: Math.floor(Math.random() * BOT_LINES.length),
    typed: 0,
    ids: [],
    phase: "typing",
    wait: 0,
  };
}

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: "connecting",
  open: "live",
  offline: "offline",
};

export function Together() {
  const reduce = useReducedMotion();
  const { ref: surfaceRef, width, height } = useElementSize<HTMLDivElement>();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { copied, copy } = useCopy();

  const [{ self, doc, roomName }] = useState(() => {
    const peer = randomPeer();
    const document_ = new Doc(peer.id);
    document_.applyAll(SEED_OPS);
    const named = new URLSearchParams(window.location.search).get("room");
    return { self: peer, doc: document_, roomName: named?.replace(/[^\w-]/g, "").slice(0, 40) || "note" };
  });

  const [text, setText] = useState(() => doc.text());
  const [title, setTitle] = useState("shared note");
  const [connection, setConnection] = useState<Connection>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  /** Mirrors of the refs below, kept for rendering only. */
  const [peers, setPeers] = useState<Peer[]>([]);
  const [botPeers, setBotPeers] = useState<Peer[]>([]);
  const [trail, setTrail] = useState<TrailEvent[]>([]);

  const roomRef = useRef<Room | null>(null);
  const peersRef = useRef(new Map<string, Peer>());
  const botsRef = useRef<Bot[]>([]);
  const pendingCaret = useRef<number | null>(null);
  const trailId = useRef(1);
  const lastEditNote = useRef(new Map<string, number>());
  /** False until the first welcome, so a first join isn't treated as a recovery. */
  const reconnecting = useRef(false);

  /** Where each remote pointer is heading, and where it is being drawn. */
  const cursors = useRef(new Map<string, { target: Cursor; shown: { x: number; y: number } }>());
  const cursorNodes = useRef(new Map<string, HTMLDivElement | null>());

  const note = useCallback((who: string, color: string, what: string) => {
    setTrail((prev) => [{ id: trailId.current++, who, color, what }, ...prev].slice(0, 7));
  }, []);

  const moveCursor = useCallback((id: string, cursor: Cursor) => {
    const existing = cursors.current.get(id);
    if (existing) existing.target = cursor;
    else cursors.current.set(id, { target: cursor, shown: { x: cursor.x, y: cursor.y } });
  }, []);

  /** Applies remote ops while keeping the caret next to the character it was after. */
  const applyRemote = useCallback(
    (ops: Op[]): boolean => {
      const field = textareaRef.current;
      const focused = !!field && document.activeElement === field;
      const caret = focused ? field.selectionStart : 0;
      const anchor = focused && caret > 0 ? doc.idAt(caret - 1) : null;

      if (!doc.applyAll(ops)) return false;
      const next = doc.text();
      setText(next);

      if (focused) {
        const index = anchor ? doc.indexOfId(anchor) : -1;
        pendingCaret.current = !anchor ? 0 : index >= 0 ? index + 1 : Math.min(caret, next.length);
      }
      return true;
    },
    [doc],
  );

  useEffect(() => {
    const field = textareaRef.current;
    if (field && pendingCaret.current !== null) {
      field.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [text]);

  // Open the stream once. Everything the handler needs afterwards lives in refs.
  useEffect(() => {
    const knownPeers = peersRef.current;

    const handle = (event: ServerEvent) => {
      const room = roomRef.current;
      switch (event.t) {
        case "welcome": {
          // The roster is authoritative, so replace rather than merge: this is
          // also how a reconnect forgets anyone who left while we were away.
          knownPeers.clear();
          for (const peer of event.peers) {
            if (peer.id !== self.id && !botsRef.current.some((bot) => bot.id === peer.id)) knownPeers.set(peer.id, peer);
          }
          setPeers([...knownPeers.values()]);
          setTitle(event.title);
          applyRemote(event.ops);
          // On a reconnect the server dropped our simulated people with the old
          // stream, and anything we sent while away never arrived: say it again.
          // On a first join there is nothing to recover, and the starting text
          // is seeded identically everywhere, so it never goes on the wire.
          if (reconnecting.current) {
            botsRef.current.forEach((bot) =>
              room?.send({ t: "joined", peer: { id: bot.id, name: bot.name, color: bot.color, simulated: true } }),
            );
            const ours = doc.ops();
            if (ours.length) room?.send({ t: "ops", from: self.id, ops: ours });
          }
          reconnecting.current = true;
          break;
        }

        case "joined":
          if (event.peer.id === self.id) break;
          knownPeers.set(event.peer.id, event.peer);
          setPeers([...knownPeers.values()]);
          note(event.peer.name, event.peer.color, event.peer.simulated ? "joined (simulated)" : "joined");
          break;

        case "left": {
          const gone = knownPeers.get(event.id);
          if (!gone) break;
          knownPeers.delete(event.id);
          cursors.current.delete(event.id);
          cursorNodes.current.delete(event.id);
          setPeers([...knownPeers.values()]);
          note(gone.name, gone.color, "left");
          break;
        }

        case "ops": {
          if (!applyRemote(event.ops)) break;
          const from = knownPeers.get(event.from);
          const now = Date.now();
          if (from && now - (lastEditNote.current.get(from.id) ?? 0) > 2500) {
            lastEditNote.current.set(from.id, now);
            note(from.name, from.color, "edited the note");
          }
          break;
        }

        case "cursor":
          moveCursor(event.from, event.cursor);
          break;

        case "title":
          setTitle(event.title);
          break;

        case "full":
          setNotice("this room has as much history as it can hold. start a new one to keep going.");
          break;
      }
    };

    const room = new Room(roomName, self, { onEvent: handle, onConnection: setConnection });
    roomRef.current = room;

    const leave = () => room.close();
    window.addEventListener("pagehide", leave);

    return () => {
      window.removeEventListener("pagehide", leave);
      room.close();
      roomRef.current = null;
      knownPeers.clear();
      setPeers([]);
    };
  }, [applyRemote, doc, moveCursor, note, roomName, self]);

  // Remote pointers ease towards their last known position instead of jumping,
  // because updates arrive at whatever rate the network manages.
  useEffect(() => {
    if (!width || !height) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const [id, node] of cursorNodes.current) {
        if (!node) continue;
        const cursor = cursors.current.get(id);
        if (!cursor) {
          node.style.opacity = "0";
          continue;
        }
        cursor.shown.x = reduce ? cursor.target.x : approach(cursor.shown.x, cursor.target.x, dt);
        cursor.shown.y = reduce ? cursor.target.y : approach(cursor.shown.y, cursor.target.y, dt);
        node.style.opacity = "1";
        node.style.transform = `translate3d(${(cursor.shown.x * width).toFixed(1)}px, ${(cursor.shown.y * height).toFixed(1)}px, 0)`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [width, height, reduce]);

  // Simulated collaborators. They send the same ops as anybody else, which is
  // why everyone in the room sees them.
  useEffect(() => {
    if (!botPeers.length) return;

    const type = setInterval(() => {
      const room = roomRef.current;
      for (const bot of botsRef.current) {
        if (bot.wait > 0) {
          bot.wait--;
          continue;
        }
        const line = BOT_LINES[bot.line];

        if (bot.phase === "typing") {
          if (bot.typed >= line.length) {
            bot.phase = "resting";
            bot.wait = 26 + Math.floor(Math.random() * 30);
            continue;
          }
          const at = bot.ids.length ? doc.indexOfId(bot.ids[bot.ids.length - 1]) + 1 : doc.length;
          const ops = doc.insertAt(at, line[bot.typed]);
          bot.ids.push(ops[0].id);
          bot.typed++;
          bot.wait = Math.random() < 0.12 ? 4 : 0;
          room?.send({ t: "ops", from: bot.id, ops });
          setText(doc.text());
          continue;
        }

        if (bot.phase === "resting") {
          bot.phase = "clearing";
          continue;
        }

        const alive = bot.ids.filter((id) => doc.indexOfId(id) >= 0);
        if (!alive.length) {
          bot.phase = "typing";
          bot.ids = [];
          bot.typed = 0;
          bot.line = (bot.line + 1) % BOT_LINES.length;
          bot.wait = 10;
          continue;
        }
        const chunk = alive.slice(-4);
        const ops: Op[] = chunk.map((id) => ({ t: "d", id }));
        doc.applyAll(ops);
        bot.ids = bot.ids.filter((id) => !chunk.includes(id));
        room?.send({ t: "ops", from: bot.id, ops });
        setText(doc.text());
      }
    }, TICK_MS);

    const drift = setInterval(() => {
      const room = roomRef.current;
      for (const bot of botsRef.current) {
        const cursor: Cursor = { x: 0.08 + Math.random() * 0.84, y: 0.08 + Math.random() * 0.84, caret: -1 };
        moveCursor(bot.id, cursor);
        room?.send({ t: "cursor", from: bot.id, cursor });
      }
    }, DRIFT_MS);

    return () => {
      clearInterval(type);
      clearInterval(drift);
    };
  }, [botPeers.length, doc, moveCursor]);

  const publishBots = () =>
    setBotPeers(botsRef.current.map(({ id, name, color, simulated }) => ({ id, name, color, simulated })));

  const addBot = () => {
    const bot = makeBot();
    botsRef.current.push(bot);
    moveCursor(bot.id, { x: 0.2 + Math.random() * 0.5, y: 0.2 + Math.random() * 0.5, caret: -1 });
    roomRef.current?.send({ t: "joined", peer: { id: bot.id, name: bot.name, color: bot.color, simulated: true } });
    publishBots();
    note(bot.name, bot.color, "joined (simulated)");
  };

  const removeBot = () => {
    const bot = botsRef.current.pop();
    if (!bot) return;
    // Take the bot's characters back out rather than leaving them behind.
    const ops: Op[] = bot.ids.filter((id) => doc.indexOfId(id) >= 0).map((id) => ({ t: "d", id }));
    if (ops.length) {
      doc.applyAll(ops);
      roomRef.current?.send({ t: "ops", from: bot.id, ops });
      setText(doc.text());
    }
    cursors.current.delete(bot.id);
    cursorNodes.current.delete(bot.id);
    roomRef.current?.send({ t: "left", id: bot.id });
    publishBots();
    note(bot.name, bot.color, "left (simulated)");
  };

  const onChange = (value: string) => {
    // Diff against the document, not the last render, so indices are always
    // valid even if an op landed a moment ago.
    const ops = doc.edit(doc.text(), value);
    setText(doc.text());
    if (ops.length) roomRef.current?.send({ t: "ops", from: self.id, ops });
  };

  const cursorFrame = useRef<number | null>(null);
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (cursorFrame.current !== null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const cursor: Cursor = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      caret: textareaRef.current?.selectionStart ?? -1,
    };
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = null;
      roomRef.current?.send({ t: "cursor", from: self.id, cursor });
    });
  };

  const everyone = [...peers, ...botPeers];
  const dotColor = connection === "open" ? "bg-[#5b8a72]" : connection === "connecting" ? "bg-faint" : "bg-accent";

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_16rem] lg:gap-10">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="label flex items-center gap-2">
              <span className={`size-1.5 rounded-full ${dotColor}`} aria-hidden />
              <span>
                {CONNECTION_LABEL[connection]} · room {roomName}
              </span>
            </div>
            <label htmlFor="together-title" className="sr-only">
              Document title
            </label>
            <input
              id="together-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                roomRef.current?.send({ t: "title", from: self.id, title: e.target.value });
              }}
              className="-ml-0.5 mt-1.5 block w-full max-w-[22rem] bg-transparent text-[18px] font-medium tracking-tight text-ink outline-none"
            />
          </div>

          <ul className="flex items-center -space-x-1.5" aria-label="People here">
            <li
              title={`${self.name} (you)`}
              className="relative z-10 flex size-7 items-center justify-center rounded-full border-2 border-paper bg-accent text-[10px] font-medium text-paper"
            >
              you
            </li>
            {everyone.map((peer) => (
              <li
                key={peer.id}
                title={`${peer.name}${peer.simulated ? " (simulated)" : ""}`}
                className="flex size-7 items-center justify-center rounded-full border-2 border-paper text-[11px] font-medium text-paper"
                style={{ backgroundColor: peer.color }}
              >
                {peer.name[0]}
              </li>
            ))}
          </ul>
        </div>

        <div
          ref={surfaceRef}
          onPointerMove={onPointerMove}
          className="relative overflow-hidden rounded-xl border border-line bg-paper-2"
        >
          <label htmlFor="together-doc" className="sr-only">
            Shared document
          </label>
          <textarea
            id="together-doc"
            ref={textareaRef}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className="relative z-10 block min-h-[26rem] w-full resize-none bg-transparent p-5 text-[15px] leading-[1.7] text-ink outline-none sm:p-6 lg:min-h-[32rem]"
          />

          <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
            {everyone.map((peer) => (
              <div
                key={peer.id}
                ref={(node) => {
                  cursorNodes.current.set(peer.id, node);
                }}
                style={{ opacity: 0 }}
                className="absolute left-0 top-0 will-change-transform"
              >
                <svg width="15" height="17" viewBox="0 0 14 16" fill={peer.color}>
                  <path d="M1 1l4.5 13 2.2-5.3L13 6.5 1 1z" stroke="var(--paper)" strokeWidth="1" strokeLinejoin="round" />
                </svg>
                <span
                  className="ml-3 -mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-medium leading-tight text-paper"
                  style={{ backgroundColor: peer.color }}
                >
                  {peer.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {notice && (
          <p className="mt-3 text-[12.5px] text-accent" role="status">
            {notice}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-[12px] text-muted">
          <span className="tnum">
            {text.length} characters · {everyone.length + 1} here
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button onClick={addBot} className="transition-colors hover:text-ink">
              add a simulated person
            </button>
            {botPeers.length > 0 && (
              <button onClick={removeBot} className="transition-colors hover:text-ink">
                remove one
              </button>
            )}
            <button onClick={() => copy(window.location.href)} className="transition-colors hover:text-ink">
              {copied ? "link copied" : "copy link"}
            </button>
            <button
              onClick={() => {
                window.location.search = `?room=${Math.random().toString(36).slice(2, 8)}`;
              }}
              className="transition-colors hover:text-ink"
            >
              new room
            </button>
          </div>
        </div>
      </div>

      <aside className="space-y-8 lg:sticky lg:top-8 lg:self-start">
        <div>
          <div className="label mb-3">here now</div>
          <ul className="space-y-2 text-[12.5px]">
            <li className="flex items-baseline gap-2.5">
              <span className="size-1.5 shrink-0 self-center rounded-full bg-accent" />
              <span className="truncate text-ink">{self.name}</span>
              <span className="ml-auto shrink-0 text-muted">you</span>
            </li>
            {everyone.map((peer) => (
              <li key={peer.id} className="flex items-baseline gap-2.5">
                <span className="size-1.5 shrink-0 self-center rounded-full" style={{ backgroundColor: peer.color }} />
                <span className="truncate text-ink">{peer.name}</span>
                <span className="ml-auto shrink-0 text-muted">{peer.simulated ? "simulated" : "here"}</span>
              </li>
            ))}
          </ul>
          {everyone.length === 0 && (
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              {connection === "offline"
                ? "the connection dropped. it will try again on its own."
                : "nobody else right now. send someone the link, or add a simulated person under the editor."}
            </p>
          )}
        </div>

        <div>
          <div className="label mb-3">trail</div>
          {trail.length === 0 ? (
            <p className="text-[12px] text-muted">nothing has happened yet.</p>
          ) : (
            <ul className="space-y-1.5 text-[12.5px]">
              <AnimatePresence initial={false} mode="popLayout">
                {trail.map((event) => (
                  <motion.li
                    key={event.id}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
                    className="flex items-baseline gap-2 text-ink-2"
                  >
                    <span className="size-1.5 shrink-0 self-center rounded-full" style={{ backgroundColor: event.color }} />
                    <span className="truncate">
                      <span className="text-ink">{event.who}</span> {event.what}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        <div className="border-t border-line pt-5 text-[12px] leading-relaxed text-muted">
          <p>
            every keystroke becomes one or two operations. they go to the server, which keeps the log and passes them
            on to everyone else in the room. the text is never sent whole.
          </p>
        </div>
      </aside>
    </div>
  );
}
