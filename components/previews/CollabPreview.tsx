"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnScreen } from "@/lib/hooks";
import { seeded } from "@/lib/random";

interface Collaborator {
  id: string;
  name: string;
  color: string;
  lines: string[];
}

const COLLABORATORS: Collaborator[] = [
  {
    id: "mara",
    name: "mara",
    color: "#3b6ea5",
    lines: [
      "we should ship the presence layer before the editor gets any bigger.",
      "cursor interpolation feels right at 120ms, anything slower reads as lag.",
      "note to self: the awareness protocol needs a heartbeat, not just a join event.",
    ],
  },
  {
    id: "jules",
    name: "jules",
    color: "#5b8a72",
    lines: [
      "renamed the activity feed to 'trail'. reads better in the sidebar.",
      "conflict handling: last-writer-wins per block is fine for now.",
      "the empty state still says lorem ipsum, fixing it today.",
    ],
  },
  {
    id: "iko",
    name: "iko",
    color: "#8a7d5c",
    lines: [
      "moved the join toast into the trail so nothing pops over the doc.",
      "keyboard nav works block to block now. tab, shift-tab, escape.",
      "question: do we show idle users at all, or just fade them?",
    ],
  },
];

interface TypingState {
  lineIndex: number;
  cursor: number;
  text: string;
  phase: "typing" | "pausing" | "deleting";
  wait: number;
}

interface Event {
  id: number;
  who: string;
  color: string;
  what: string;
}

interface CursorPos {
  x: number;
  y: number;
}

const TICK_MS = 90;

const TRAIL_VERBS = ["edited block", "left a comment on block", "rewrote a line in block", "resolved a thread on block"];

function initialTyping(c: Collaborator, rand: () => number): TypingState {
  const lineIndex = Math.floor(rand() * c.lines.length);
  const line = c.lines[lineIndex];
  const cursor = Math.floor(line.length * (0.3 + rand() * 0.5));
  return { lineIndex, cursor, text: line.slice(0, cursor), phase: "typing", wait: Math.floor(rand() * 8) };
}

export function CollabPreview() {
  const reduce = useReducedMotion();
  const { ref: screenRef, visible } = useOnScreen<HTMLDivElement>("120px");
  const areaRef = useRef<HTMLDivElement | null>(null);
  const rand = useMemo(() => seeded(7), []);

  const [yours, setYours] = useState(
    "this block is yours. the other three belong to people who don't exist, but the room behaves as if they do.",
  );
  const [typing, setTyping] = useState<Record<string, TypingState>>(() =>
    Object.fromEntries(COLLABORATORS.map((c) => [c.id, initialTyping(c, rand)])),
  );
  const [cursors, setCursors] = useState<Record<string, CursorPos>>(() =>
    Object.fromEntries(COLLABORATORS.map((c, i) => [c.id, { x: 0.2 + i * 0.25, y: 0.35 + i * 0.15 }])),
  );
  const [events, setEvents] = useState<Event[]>([
    { id: 1, who: "iko", color: COLLABORATORS[2].color, what: "joined the room" },
    { id: 2, who: "mara", color: COLLABORATORS[0].color, what: "edited block 2" },
    { id: 3, who: "jules", color: COLLABORATORS[1].color, what: "renamed the document" },
  ]);
  const eventId = useRef(4);
  const yourEditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushEvent = useCallback((who: string, color: string, what: string) => {
    setEvents((prev) => [{ id: eventId.current++, who, color, what }, ...prev].slice(0, 5));
  }, []);

  const typingRef = useRef(typing);

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      const prev = typingRef.current;
      const next: Record<string, TypingState> = {};
      const emitted: Collaborator[] = [];
      for (const c of COLLABORATORS) {
        const s = prev[c.id];
        const line = c.lines[s.lineIndex];
        if (s.wait > 0) {
          next[c.id] = { ...s, wait: s.wait - 1 };
          continue;
        }
        if (s.phase === "typing") {
          if (s.cursor < line.length) {
            const step = rand() < 0.15 ? 2 : 1;
            const cursor = Math.min(line.length, s.cursor + step);
            const pause = rand() < 0.08 ? Math.floor(rand() * 6) : 0;
            next[c.id] = { ...s, cursor, text: line.slice(0, cursor), wait: pause };
          } else {
            next[c.id] = { ...s, phase: "pausing", wait: 18 + Math.floor(rand() * 25) };
          }
        } else if (s.phase === "pausing") {
          next[c.id] = { ...s, phase: "deleting", wait: 0 };
          if (rand() < 0.5) emitted.push(c);
        } else if (s.cursor > 0) {
          const cursor = Math.max(0, s.cursor - 3);
          next[c.id] = { ...s, cursor, text: line.slice(0, cursor) };
        } else {
          const lineIndex = (s.lineIndex + 1) % c.lines.length;
          next[c.id] = { lineIndex, cursor: 0, text: "", phase: "typing", wait: 6 + Math.floor(rand() * 10) };
        }
      }
      typingRef.current = next;
      setTyping(next);
      for (const c of emitted) {
        const verb = TRAIL_VERBS[Math.floor(rand() * TRAIL_VERBS.length)];
        pushEvent(c.name, c.color, `${verb} ${COLLABORATORS.indexOf(c) + 2}`);
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [visible, rand, pushEvent]);

  useEffect(() => {
    if (!visible) return;
    const timers = COLLABORATORS.map((c, i) =>
      setInterval(
        () => {
          setCursors((prev) => ({
            ...prev,
            [c.id]: { x: 0.08 + rand() * 0.84, y: 0.08 + rand() * 0.84 },
          }));
        },
        1900 + i * 650,
      ),
    );
    return () => timers.forEach(clearInterval);
  }, [visible, rand]);

  const onYourChange = (value: string) => {
    setYours(value);
    if (yourEditTimer.current) clearTimeout(yourEditTimer.current);
    yourEditTimer.current = setTimeout(() => pushEvent("you", "var(--accent)", "edited block 1"), 900);
  };

  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 60, damping: 18, mass: 1.2 };

  return (
    <div ref={screenRef} className="grid h-full gap-0 text-ink @2xl:grid-cols-[1fr_13.5rem]">
      <div className="flex min-w-0 flex-col p-5 @md:p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="label">together / room 0x3f</div>
            <h3 className="mt-1 truncate text-[15px] font-medium tracking-tight">roadmap notes</h3>
          </div>
          <ul className="flex items-center -space-x-1.5" aria-label="People in the room">
            <li
              className="relative z-10 flex size-6 items-center justify-center rounded-full border-2 border-paper-2 bg-accent text-[10px] font-medium text-paper"
              title="you"
            >
              y
            </li>
            {COLLABORATORS.map((c) => (
              <li
                key={c.id}
                title={c.name}
                className="flex size-6 items-center justify-center rounded-full border-2 border-paper-2 text-[10px] font-medium text-paper"
                style={{ backgroundColor: c.color }}
              >
                {c.name[0]}
              </li>
            ))}
          </ul>
        </div>

        <div ref={areaRef} className="relative flex-1 text-[14px] leading-[1.65]">
          <div className="space-y-4">
            <div className="group relative">
              <label htmlFor="collab-yours" className="sr-only">
                Your block
              </label>
              <textarea
                id="collab-yours"
                value={yours}
                onChange={(e) => onYourChange(e.target.value)}
                rows={3}
                spellCheck={false}
                className="block w-full resize-none rounded-md border border-transparent bg-transparent px-2.5 py-1.5 -mx-2.5 text-ink outline-none transition-colors placeholder:text-faint focus-visible:border-line focus-visible:bg-paper focus-visible:outline-none"
                style={{ boxShadow: "inset 2px 0 0 0 var(--accent)" }}
              />
            </div>

            {COLLABORATORS.map((c) => {
              const s = typing[c.id];
              const isTyping = s.phase === "typing" && s.wait === 0 && s.cursor < c.lines[s.lineIndex].length;
              return (
                <p key={c.id} className="relative pl-0 text-ink-2" style={{ boxShadow: `inset 2px 0 0 0 ${c.color}` }}>
                  <span className="block px-2.5 py-1.5 -mx-2.5 pl-0 ml-2.5">
                    {s.text}
                    <span
                      aria-hidden
                      className={`relative -mb-[3px] ml-px inline-block h-[1.1em] w-[1.5px] align-text-bottom ${isTyping ? "" : "motion-safe:animate-pulse"}`}
                      style={{ backgroundColor: c.color }}
                    />
                  </span>
                </p>
              );
            })}
          </div>

          <div className="pointer-events-none absolute inset-0 hidden @md:block" aria-hidden>
            {COLLABORATORS.map((c) => (
              <motion.div
                key={c.id}
                className="absolute left-0 top-0"
                animate={{ left: `${cursors[c.id].x * 100}%`, top: `${cursors[c.id].y * 100}%` }}
                transition={spring}
              >
                <svg width="14" height="16" viewBox="0 0 14 16" fill={c.color} className="drop-shadow-sm">
                  <path d="M1 1l4.5 13 2.2-5.3L13 6.5 1 1z" stroke="var(--paper)" strokeWidth="1" strokeLinejoin="round" />
                </svg>
                <span
                  className="ml-3 -mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-medium leading-tight text-paper"
                  style={{ backgroundColor: c.color }}
                >
                  {c.name}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <aside className="hairline grid gap-6 border-line p-5 @md:grid-cols-2 @md:p-6 @2xl:grid-cols-1 @2xl:content-start @2xl:border-t-0 @2xl:border-l @2xl:p-5">
        <div>
          <div className="label mb-2.5">here now</div>
          <ul className="space-y-2 text-[12px]">
            <li className="flex items-center gap-2.5">
              <span className="size-1.5 rounded-full bg-accent" />
              <span className="text-ink">you</span>
              <span className="ml-auto text-muted">block 1</span>
            </li>
            {COLLABORATORS.map((c, i) => {
              const s = typing[c.id];
              const status =
                s.phase === "typing" && s.wait === 0 ? "typing" : s.phase === "deleting" ? "editing" : "reading";
              return (
                <li key={c.id} className="flex items-center gap-2.5">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="text-ink">{c.name}</span>
                  <span className="ml-auto text-muted">
                    {status} · b{i + 2}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <div className="label mb-2.5">trail</div>
          <ul className="space-y-1.5 text-[12px]">
            <AnimatePresence initial={false} mode="popLayout">
              {events.map((e) => (
                <motion.li
                  key={e.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
                  className="flex items-baseline gap-2 text-ink-2"
                >
                  <span className="size-1.5 shrink-0 self-center rounded-full" style={{ backgroundColor: e.color }} />
                  <span className="truncate">
                    <span className="text-ink">{e.who}</span> {e.what}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </aside>
    </div>
  );
}
