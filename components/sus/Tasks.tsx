"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { seededRandom, type Random } from "@/lib/random";
import type { Task } from "@/lib/sus/ship";
import { useLocalNow } from "@/components/game/clock";

/**
 * The tasks: a small game each, played in the browser. Finishing one tells
 * the room (see lib/sus/room.ts, which checks you were there long enough).
 * Each is laid out from a seed picked when it's opened, so it's the same
 * however often it redraws, and different every time you open it.
 */

interface Props {
  seed: string;
  onDone: () => void;
}

const PANEL = "#2b2f36";

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-center text-[13px] text-white/75">{children}</p>;
}

/** Keyboard and pointer both, for anything in an SVG that's pressed. */
const pressable = (label: string, onPress: () => void) => ({
  role: "button",
  tabIndex: 0,
  "aria-label": label,
  onClick: onPress,
  onKeyDown: (e: { key: string; preventDefault(): void }) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPress();
    }
  },
  className: "cursor-pointer outline-none focus-visible:opacity-80",
});

/* ---------------------------------------------------------------- wires */

const WIRES = [
  { name: "red", hex: "#e03131" },
  { name: "blue", hex: "#1c7ed6" },
  { name: "yellow", hex: "#f5c000" },
  { name: "pink", hex: "#d6336c" },
];

function Wires({ seed, onDone }: Props) {
  const [order] = useState(() => shuffle([0, 1, 2, 3], seededRandom(seed)));
  const [held, setHeld] = useState<number | null>(null);
  const [joined, setJoined] = useState<number[]>([]);
  const y = (i: number) => 34 + i * 52;
  const plug = (wire: number) => {
    if (held === wire) {
      const next = [...joined, wire];
      setJoined(next);
      if (next.length === WIRES.length) onDone();
    }
    setHeld(null);
  };
  return (
    <>
      <svg viewBox="0 0 300 220" className="w-full rounded-xl" style={{ background: PANEL }}>
        {joined.map((w) => (
          <path key={w} d={`M36 ${y(w)}C150 ${y(w)} 150 ${y(order.indexOf(w))} 264 ${y(order.indexOf(w))}`} stroke={WIRES[w].hex} strokeWidth={10} fill="none" strokeLinecap="round" />
        ))}
        {WIRES.map((wire, i) => (
          <g key={`left${i}`} {...pressable(`${wire.name} wire`, () => !joined.includes(i) && setHeld(i))}>
            <rect x={4} y={y(i) - 15} width={34} height={30} rx={5} fill={wire.hex} stroke={held === i ? "#fff" : "#111"} strokeWidth={held === i ? 4 : 2} />
          </g>
        ))}
        {order.map((w, j) => (
          <g key={`right${j}`} {...pressable(`to ${WIRES[w].name}`, () => plug(w))}>
            <rect x={262} y={y(j) - 15} width={34} height={30} rx={5} fill={WIRES[w].hex} stroke="#111" strokeWidth={2} />
          </g>
        ))}
      </svg>
      <Hint>{held === null ? "tap a wire on the left, then its colour on the right" : `now the ${WIRES[held].name} one on the right`}</Hint>
    </>
  );
}

/* ---------------------------------------------------------------- swipe */

function Swipe({ onDone }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; at: number; end: number } | null>(null);
  const [x, setX] = useState(0);
  const [note, setNote] = useState("drag the card along the slot, steadily");
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: e.clientX, at: performance.now(), end: Math.max(0, (track.current?.clientWidth ?? 300) - 96) });
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (drag) setX(Math.max(0, Math.min(drag.end, e.clientX - drag.from)));
  };
  const up = () => {
    if (!drag) return;
    setDrag(null);
    const took = performance.now() - drag.at;
    const through = x >= drag.end - 6;
    setX(0);
    if (!through) setNote("all the way along");
    else if (took < 350) setNote("too fast. try again.");
    else if (took > 1600) setNote("too slow. try again.");
    else {
      setNote("accepted. thank you.");
      onDone();
    }
  };
  return (
    <>
      <div ref={track} className="relative h-28 overflow-hidden rounded-xl" style={{ background: PANEL }}>
        <div className="absolute inset-x-4 top-1/2 h-3 -translate-y-1/2 rounded-full bg-black/70" />
        <button
          type="button"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          // Swiping by keyboard: one steady swipe.
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            setNote("accepted. thank you.");
            onDone();
          }}
          aria-label="your card: drag it along the slot, or press enter to swipe it"
          style={{ transform: `translateX(${x}px)`, transition: drag ? "none" : "transform 200ms" }}
          className="absolute left-3 top-5 flex h-[4.5rem] w-20 cursor-grab touch-none select-none flex-col justify-between rounded-lg bg-[#5c940d] p-1.5 text-left text-[10px] font-bold text-white shadow-lg active:cursor-grabbing"
        >
          <span>ID</span>
          <span className="h-2 w-full rounded bg-white/60" />
        </button>
      </div>
      <Hint>{note}</Hint>
    </>
  );
}

/* ------------------------------------------------------- downloads, holds */

function useFinish(complete: boolean, onDone: () => void) {
  useEffect(() => {
    if (complete) onDone();
  }, [complete, onDone]);
}

function Download({ onDone, label }: Props & { label: string }) {
  const [started, setStarted] = useState<number | null>(null);
  const now = useLocalNow(100);
  const share = started === null ? 0 : Math.min(1, (now - started) / 6500);
  useFinish(share >= 1, onDone);
  return (
    <div className="rounded-xl p-5 text-center text-white" style={{ background: PANEL }}>
      {started === null ? (
        <button type="button" onClick={() => setStarted(Date.now())} className="rounded-lg bg-[#1c7ed6] px-5 py-2.5 text-[15px] font-semibold hover:bg-[#1971c2]">
          {label}
        </button>
      ) : (
        <>
          <div className="h-5 overflow-hidden rounded-full bg-black/60">
            <div className="h-full bg-[#40c057]" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="mt-2 font-mono text-[12px] text-white/70">{share >= 1 ? "complete" : `estimated time: ${Math.ceil((1 - share) * 6.5)}s`}</p>
        </>
      )}
    </div>
  );
}

function Hold({ onDone, label }: Props & { label: string }) {
  const [held, setHeld] = useState(false);
  const [share, setShare] = useState(0);
  useEffect(() => {
    if (!held) return;
    const timer = setInterval(() => setShare((s) => Math.min(1, s + 1 / 30)), 100);
    return () => clearInterval(timer);
  }, [held]);
  useFinish(share >= 1, onDone);
  const on = () => setHeld(true);
  const off = () => setHeld(false);
  return (
    <div className="flex items-center gap-4 rounded-xl p-5 text-white" style={{ background: PANEL }}>
      <div className="relative h-36 w-20 overflow-hidden rounded-lg border-2 border-white/30 bg-black/40">
        <div className="absolute inset-x-0 bottom-0 bg-[#a9774d]" style={{ height: `${(1 - share) * 100}%` }} />
      </div>
      <button
        type="button"
        onPointerDown={on}
        onPointerUp={off}
        onPointerLeave={off}
        onPointerCancel={off}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && on()}
        onKeyUp={off}
        className={`flex-1 touch-none select-none rounded-lg px-3 py-6 text-[15px] font-semibold transition ${held ? "translate-y-1 bg-[#495057]" : "bg-[#868e96]"}`}
      >
        {share >= 1 ? "empty!" : held ? "keep holding…" : label}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- simon */

const LEVELS = [2, 3, 4];

function Simon({ seed, onDone }: Props) {
  const [sequence] = useState(() => {
    const random = seededRandom(seed);
    return Array.from({ length: LEVELS.at(-1)! }, () => Math.floor(random() * 9));
  });
  const [level, setLevel] = useState(0);
  const [showing, setShowing] = useState(true);
  const [lit, setLit] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [note, setNote] = useState("watch the lights…");

  useEffect(() => {
    if (!showing) return;
    let tick = 0;
    const length = LEVELS[level];
    const timer = setInterval(() => {
      tick++;
      if (tick > length * 2) {
        clearInterval(timer);
        setLit(null);
        setShowing(false);
        setNote("now you: tap them in the same order");
        return;
      }
      setLit(tick % 2 === 1 ? sequence[(tick - 1) / 2] : null);
    }, 380);
    return () => clearInterval(timer);
  }, [showing, level, sequence]);

  const press = (cell: number) => {
    if (showing) return;
    setLit(cell);
    setTimeout(() => setLit((l) => (l === cell ? null : l)), 160);
    if (cell !== sequence[step]) {
      setNote("wrong. watch again…");
      setStep(0);
      setShowing(true);
    } else if (step + 1 < LEVELS[level]) {
      setStep(step + 1);
    } else if (level + 1 < LEVELS.length) {
      setLevel(level + 1);
      setStep(0);
      setShowing(true);
      setNote("good. watch again…");
    } else {
      setNote("reactor started.");
      onDone();
    }
  };

  return (
    <>
      <div className="flex justify-center gap-1.5 pb-2">
        {LEVELS.map((_, i) => (
          <span key={i} className={`size-2.5 rounded-full ${i < level ? "bg-[#40c057]" : i === level ? "bg-white" : "bg-white/25"}`} />
        ))}
      </div>
      <div className="mx-auto grid max-w-[15rem] grid-cols-3 gap-2 rounded-xl p-3" style={{ background: PANEL }}>
        {Array.from({ length: 9 }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`panel ${i + 1}`}
            disabled={showing}
            onClick={() => press(i)}
            className={`aspect-square rounded-md transition-colors ${lit === i ? "bg-[#4dabf7]" : "bg-black/50"} ${showing ? "cursor-default" : "hover:bg-black/30"}`}
          />
        ))}
      </div>
      <Hint>{note}</Hint>
    </>
  );
}

/* -------------------------------------------------------------- numbers */

function Numbers({ seed, onDone }: Props) {
  const [order] = useState(() => shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], seededRandom(seed)));
  const [next, setNext] = useState(1);
  const press = (n: number) => {
    if (n !== next) return setNext(1);
    if (n === 10) onDone();
    setNext(n + 1);
  };
  return (
    <>
      <div className="grid grid-cols-5 gap-2 rounded-xl p-3" style={{ background: PANEL }}>
        {order.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => press(n)}
            className={`aspect-square rounded-md text-[18px] font-bold transition-colors ${n < next ? "bg-[#2f9e44] text-white" : "bg-[#dee2e6] text-[#212529] hover:bg-white"}`}
          >
            {n}
          </button>
        ))}
      </div>
      <Hint>tap 1 to 10 in order</Hint>
    </>
  );
}

/* ----------------------------------------------------------------- scan */

function Scan({ seed, onDone, impostor }: Props & { impostor: boolean }) {
  const now = useLocalNow(100);
  const [opened] = useState(Date.now);
  const [card] = useState(() => {
    const random = seededRandom(seed);
    return { height: `${3 + Math.floor(random() * 2)}'${Math.floor(random() * 12)}"`, weight: `${80 + Math.floor(random() * 40)}lb`, blood: ["O-", "O+", "A-", "A+", "B+", "AB+"][Math.floor(random() * 6)] };
  });
  const share = impostor ? 0 : Math.min(1, (now - opened) / 9000);
  useFinish(share >= 1, onDone);
  return (
    <div className="rounded-xl p-5 text-white" style={{ background: PANEL }}>
      {impostor ? (
        <p className="text-center text-[14px] text-white/80">the scanner won&rsquo;t take you. anyone in here can see you&rsquo;re not on it, so don&rsquo;t hang about.</p>
      ) : (
        <>
          <div className="relative mx-auto h-28 w-24 overflow-hidden rounded-lg bg-black/50">
            <div className="absolute inset-x-0 h-1 bg-[#51cf66] shadow-[0_0_12px_#51cf66]" style={{ top: `${(Math.sin(share * Math.PI * 6) * 0.5 + 0.5) * 100}%` }} />
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/60">
            <div className="h-full bg-[#51cf66]" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="mt-2 font-mono text-[12px] text-white/70">
            {share >= 1 ? "scan complete" : share > 0.66 ? `blood type ${card.blood}` : share > 0.33 ? `weight ${card.weight}` : `height ${card.height}`}
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ asteroids */

const ASTEROIDS_NEEDED = 10;

function Rock({ id, y, ms, onHit, onGone }: { id: number; y: number; ms: number; onHit: (id: number) => void; onGone: (id: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const animation = ref.current?.animate([{ left: "100%", rotate: "0deg" }, { left: "-14%", rotate: "-220deg" }], { duration: ms, easing: "linear", fill: "forwards" });
    if (animation) animation.onfinish = () => onGone(id);
    return () => animation?.cancel();
  }, [id, ms, onGone]);
  return (
    <button
      ref={ref}
      type="button"
      aria-label="asteroid"
      onPointerDown={() => onHit(id)}
      className="absolute size-10 rounded-[45%_55%_50%_40%] border-2 border-[#15171a] bg-[#8d7f6f] shadow-inner"
      style={{ top: `${y}%`, left: "100%" }}
    />
  );
}

function Asteroids({ seed, onDone }: Props) {
  const [random] = useState(() => seededRandom(seed));
  const [rocks, setRocks] = useState<{ id: number; y: number; ms: number }[]>([]);
  const [hits, setHits] = useState(0);
  const count = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => {
      const id = ++count.current;
      setRocks((all) => [...all.slice(-7), { id, y: 4 + random() * 78, ms: 1900 + random() * 1300 }]);
    }, 520);
    return () => clearInterval(timer);
  }, [random]);
  useFinish(hits >= ASTEROIDS_NEEDED, onDone);
  const drop = useCallback((id: number) => setRocks((all) => all.filter((r) => r.id !== id)), []);
  // A rock only counts once, however many fingers get it.
  const struck = useRef(new Set<number>());
  const hit = useCallback(
    (id: number) => {
      if (struck.current.has(id)) return;
      struck.current.add(id);
      drop(id);
      setHits((h) => h + 1);
    },
    [drop],
  );
  return (
    <>
      <div className="relative h-64 overflow-hidden rounded-xl bg-[#0b1020]" style={{ backgroundImage: "radial-gradient(#fff5 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
        {rocks.map((rock) => (
          <Rock key={rock.id} id={rock.id} y={rock.y} ms={rock.ms} onHit={hit} onGone={drop} />
        ))}
        <span className="absolute bottom-2 right-3 font-mono text-[13px] text-[#69db7c]">
          destroyed: {Math.min(hits, ASTEROIDS_NEEDED)}/{ASTEROIDS_NEEDED}
        </span>
      </div>
      <Hint>tap the asteroids before they get past</Hint>
    </>
  );
}

/* ------------------------------------------------------------- shields */

const HEXES = [
  [150, 110],
  [150, 50],
  [202, 80],
  [202, 140],
  [150, 170],
  [98, 140],
  [98, 80],
];

const hexagon = (x: number, y: number, r = 30) =>
  Array.from({ length: 6 }, (_, i) => `${x + r * Math.cos((Math.PI / 3) * i)},${y + r * Math.sin((Math.PI / 3) * i)}`).join(" ");

function Shields({ seed, onDone }: Props) {
  const [red, setRed] = useState(() => {
    const random = seededRandom(seed);
    const out = HEXES.map(() => random() < 0.5);
    out[Math.floor(random() * 7)] = true;
    out[(Math.floor(random() * 6) + 1) % 7] = true;
    return out;
  });
  const prime = (i: number) => {
    const next = red.map((r, j) => (j === i ? false : r));
    setRed(next);
    if (next.every((r) => !r)) onDone();
  };
  return (
    <>
      <svg viewBox="0 0 300 220" className="w-full rounded-xl" style={{ background: PANEL }}>
        {HEXES.map(([x, y], i) => (
          <g key={i} {...pressable(red[i] ? "red panel" : "primed panel", () => prime(i))}>
            <polygon points={hexagon(x, y)} fill={red[i] ? "#e03131" : "#e9ecef"} stroke="#15171a" strokeWidth={3} />
          </g>
        ))}
      </svg>
      <Hint>tap the red ones to prime them</Hint>
    </>
  );
}

/* --------------------------------------------------------------- course */

function Course({ seed, onDone }: Props) {
  const [points] = useState(() => {
    const random = seededRandom(seed);
    return [30, 90, 150, 210, 270].map((x) => [x, 40 + random() * 140] as const);
  });
  const [next, setNext] = useState(1);
  const tap = (i: number) => {
    if (i !== next) return;
    if (i === points.length - 1) onDone();
    setNext(i + 1);
  };
  const path = points.slice(0, next).map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");
  return (
    <>
      <svg viewBox="0 0 300 220" className="w-full rounded-xl bg-[#0b1020]">
        <path d={points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("")} stroke="#fff3" strokeWidth={3} strokeDasharray="6 8" fill="none" />
        <path d={path} stroke="#ffd43b" strokeWidth={4} fill="none" />
        {points.map(([x, y], i) => (
          <g key={i} {...pressable(`point ${i + 1}`, () => tap(i))}>
            <circle cx={x} cy={y} r={16} fill="transparent" />
            <circle cx={x} cy={y} r={i < next ? 9 : 11} fill={i < next ? "#ffd43b" : i === next ? "#4dabf7" : "#fff6"} stroke="#15171a" strokeWidth={2} />
          </g>
        ))}
      </svg>
      <Hint>tap the points in order to plot the course</Hint>
    </>
  );
}

/* --------------------------------------------------------------- steer */

function Steer({ seed, onDone }: Props) {
  const [aim, setAim] = useState(() => {
    const random = seededRandom(seed);
    return { x: 60 + random() * 180, y: 40 + random() * 140 };
  });
  const [note, setNote] = useState("tap the middle of the target");
  const tap = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 300;
    const y = ((e.clientY - box.top) / box.height) * 220;
    setAim({ x, y });
    if (Math.hypot(x - 150, y - 110) <= 16) {
      setNote("steady as she goes.");
      onDone();
    } else setNote("closer to the middle");
  };
  return (
    <>
      <svg viewBox="0 0 300 220" className="w-full cursor-crosshair touch-none rounded-xl bg-[#0b1020]" onPointerDown={tap}>
        <circle cx={150} cy={110} r={80} stroke="#4dabf755" strokeWidth={2} fill="none" />
        <circle cx={150} cy={110} r={40} stroke="#4dabf788" strokeWidth={2} fill="none" />
        <circle cx={150} cy={110} r={14} stroke="#4dabf7" strokeWidth={3} fill="none" />
        <path d="M150 20V200M60 110H240" stroke="#4dabf733" strokeWidth={2} />
        <g stroke="#ffd43b" strokeWidth={3}>
          <circle cx={aim.x} cy={aim.y} r={10} fill="none" />
          <path d={`M${aim.x - 18} ${aim.y}h10M${aim.x + 8} ${aim.y}h10M${aim.x} ${aim.y - 18}v10M${aim.x} ${aim.y + 8}v10`} />
        </g>
      </svg>
      <Hint>{note}</Hint>
    </>
  );
}

/* --------------------------------------------------------------- filter */

function Filter({ seed, onDone }: Props) {
  const [leaves, setLeaves] = useState(() => {
    const random = seededRandom(seed);
    // A slot each, shuffled about a little, so none hides another.
    return Array.from({ length: 6 }, (_, i) => ({ id: i, x: 95 + (i % 3) * 55 + (random() - 0.5) * 24, y: 80 + Math.floor(i / 3) * 60 + (random() - 0.5) * 20, turn: random() * 360 }));
  });
  const clear = (id: number) => {
    const next = leaves.filter((l) => l.id !== id);
    setLeaves(next);
    if (next.length === 0) onDone();
  };
  return (
    <>
      <svg viewBox="0 0 300 220" className="w-full rounded-xl" style={{ background: PANEL }}>
        <circle cx={150} cy={110} r={100} fill="#15171a" stroke="#868e96" strokeWidth={4} />
        {leaves.map((leaf) => (
          <g key={leaf.id} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.turn})`} {...pressable("leaf", () => clear(leaf.id))}>
            <circle r={20} fill="transparent" />
            <path d="M0 -16C12 -8 12 8 0 16C-12 8 -12 -8 0 -16Z" fill="#74b816" stroke="#2b8a3e" strokeWidth={2} />
            <path d="M0 -14V14" stroke="#2b8a3e" strokeWidth={1.5} />
          </g>
        ))}
      </svg>
      <Hint>tap the leaves to clear them out</Hint>
    </>
  );
}

/* ---------------------------------------------------------------- align */

function Align({ seed, onDone }: Props) {
  const [target] = useState(() => 12 + seededRandom(seed)() * 76);
  const [value, setValue] = useState(50);
  const close = Math.abs(value - target) <= 4;
  const settle = () => {
    if (close) onDone();
  };
  return (
    <div className="rounded-xl p-5 text-white" style={{ background: PANEL }}>
      <div className="relative h-10">
        <div className="absolute top-0 h-full w-1 -translate-x-1/2 rounded bg-[#ffd43b]" style={{ left: `${target}%` }} />
        <div className={`absolute top-2 h-6 w-3 -translate-x-1/2 rounded ${close ? "bg-[#51cf66]" : "bg-[#4dabf7]"}`} style={{ left: `${value}%` }} />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        aria-label="engine output"
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={settle}
        onKeyUp={settle}
        className="mt-2 w-full accent-[#4dabf7]"
      />
      <Hint>line the output up with the yellow mark, and let go</Hint>
    </div>
  );
}

/* ---------------------------------------------------------------- lights */

/** Not a task: what anyone does in electrical to put the lights back on. */
export function Switches({ seed, onDone }: Props) {
  const [up, setUp] = useState(() => {
    const random = seededRandom(seed);
    const out = Array.from({ length: 5 }, () => random() < 0.4);
    out[Math.floor(random() * 5)] = false;
    return out;
  });
  const flip = (i: number) => {
    const next = up.map((u, j) => (j === i ? !u : u));
    setUp(next);
    if (next.every(Boolean)) onDone();
  };
  return (
    <>
      <div className="flex justify-center gap-3 rounded-xl p-5" style={{ background: PANEL }}>
        {up.map((on, i) => (
          <button key={i} type="button" aria-label={`switch ${i + 1}, ${on ? "up" : "down"}`} aria-pressed={on} onClick={() => flip(i)} className="flex flex-col items-center gap-2">
            <span className={`size-3 rounded-full ${on ? "bg-[#51cf66] shadow-[0_0_8px_#51cf66]" : "bg-black/60"}`} />
            <span className="relative h-20 w-9 rounded-md bg-black/60">
              <span className={`absolute inset-x-1 h-8 rounded bg-[#ced4da] transition-all ${on ? "top-1" : "top-11"}`} />
            </span>
          </button>
        ))}
      </div>
      <Hint>flip every switch up</Hint>
    </>
  );
}

/* ---------------------------------------------------------------- panel */

/** A task's game, whichever it is. `onDone` is called once, however it gets there. */
export function TaskGame({ task, seed, impostor, onDone }: { task: Task; seed: string; impostor: boolean; onDone: () => void }) {
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);
  const props = { seed, onDone: finish };
  switch (task.kind) {
    case "wires":
      return <Wires {...props} />;
    case "swipe":
      return <Swipe {...props} />;
    case "download":
      return <Download {...props} label={task.id === "upload" ? "upload" : "download"} />;
    case "hold":
      return <Hold {...props} label="hold the lever" />;
    case "simon":
      return <Simon {...props} />;
    case "numbers":
      return <Numbers {...props} />;
    case "scan":
      return <Scan {...props} impostor={impostor} />;
    case "asteroids":
      return <Asteroids {...props} />;
    case "shields":
      return <Shields {...props} />;
    case "course":
      return <Course {...props} />;
    case "steer":
      return <Steer {...props} />;
    case "filter":
      return <Filter {...props} />;
    case "align":
      return <Align {...props} />;
  }
}
