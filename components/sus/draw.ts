import type { PlayerView } from "@/lib/sus/room";
import { COLORS, ROOM_IDS, SPOTS, TASKS, TILE, VENTS, VENT_BY_ID, ZONES, ZONE_IDS, zoneOfTile, type Point, type ZoneId } from "@/lib/sus/ship";
import { RADIUS, WALLS, canSee, visibility } from "@/lib/sus/space";
import type { Engine } from "./engine";

/**
 * Drawing the ship on a canvas: the floor and walls, the things in each
 * room, everyone in it, and the dark beyond what you can see. Everything's
 * drawn in the ship's own units under a transform, so it's sharp at any
 * size; the game screen (./Play.tsx) and security's cameras both use it.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How many units the shorter side of the screen shows, at most, and the longer. */
export const VIEW = 980;
export const VIEW_LONG = 1500;
const HULL = 18;

const FLOOR: Record<ZoneId, string> = {
  cafeteria: "#a3adbd",
  weapons: "#9aa3b3",
  o2: "#98aebb",
  navigation: "#9aa5bb",
  shields: "#a0a6b6",
  comms: "#a0a3ad",
  storage: "#a79f93",
  admin: "#a9b0a6",
  electrical: "#a3a290",
  lower: "#a5a0a4",
  security: "#9ba2ad",
  reactor: "#ab9f9f",
  upper: "#a5a0a4",
  medbay: "#a4b6b8",
  "hall-upper": "#868e9c",
  "hall-left": "#868e9c",
  "hall-lower": "#868e9c",
  "hall-central": "#868e9c",
  "hall-weapons": "#868e9c",
  "hall-o2": "#868e9c",
  "hall-east": "#868e9c",
  "hall-south": "#868e9c",
};

/** A colour mixed toward black. */
export function darker(hex: string, amount = 0.3): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

const overlaps = (a: Rect, x: number, y: number, w: number, h: number) => x < a.x + a.w && x + w > a.x && y < a.y + a.h && y + h > a.y;

/* ---------------------------------------------------------------- stars */

const STARS = Array.from({ length: 140 }, (_, i) => {
  // A fixed scatter, the same every time.
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: r(1), y: r(2), size: 0.6 + r(3) * 1.6, depth: 0.15 + r(4) * 0.35 };
});

/** Space behind the ship, drifting a little as you walk. In screen pixels. */
export function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number) {
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  const size = Math.max(w, h, 600);
  for (const star of STARS) {
    const x = (((star.x * size - cx * star.depth * 0.2) % size) + size) % size;
    const y = (((star.y * size - cy * star.depth * 0.2) % size) + size) % size;
    if (x > w || y > h) continue;
    ctx.globalAlpha = 0.35 + star.depth;
    ctx.fillRect(x, y, star.size, star.size);
  }
  ctx.globalAlpha = 1;
}

/* ----------------------------------------------------------------- ship */

let tiles: CanvasPattern | null = null;

function tilePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (tiles) return tiles;
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.fillStyle = "rgba(0, 0, 0, 0.07)";
  c.fillRect(0, 0, TILE, 2);
  c.fillRect(0, 0, 2, TILE);
  c.fillStyle = "rgba(255, 255, 255, 0.06)";
  c.fillRect(2, 2, TILE - 2, 1);
  tiles = ctx.createPattern(canvas, "repeat");
  return tiles;
}

const floorAt = (x: number, y: number) => zoneOfTile(Math.floor(x / TILE), Math.floor(y / TILE)) !== null;

/** The top edges of rooms, where the wall behind is seen face on. */
const FACES = WALLS.filter(([x1, y1, x2, y2]) => y1 === y2 && floorAt((x1 + x2) / 2, y1 + 1) && !floorAt((x1 + x2) / 2, y1 - 1));

export interface ShipOptions {
  /** Tasks to mark: yours, not done yet. */
  tasks: ReadonlySet<string>;
  sabotage: "lights" | "reactor" | null;
  /** Show the vents lit up, for an impostor. */
  vents: boolean;
  /** Which vent you're in, and so where the arrows go from. */
  inVent: string | null;
  t: number;
}

export function drawShip(ctx: CanvasRenderingContext2D, view: Rect, o: ShipOptions) {
  // The hull: a thick edge round every block of floor.
  ctx.fillStyle = "#2b303b";
  for (const id of ZONE_IDS) {
    for (const [c, r, w, h] of ZONES[id].boxes) {
      const x = c * TILE - HULL;
      const y = r * TILE - HULL * 2;
      if (overlaps(view, x, y, w * TILE + HULL * 2, h * TILE + HULL * 3)) ctx.fillRect(x, y, w * TILE + HULL * 2, h * TILE + HULL * 3);
    }
  }
  const pattern = tilePattern(ctx);
  for (const id of ZONE_IDS) {
    for (const [c, r, w, h] of ZONES[id].boxes) {
      if (!overlaps(view, c * TILE, r * TILE, w * TILE, h * TILE)) continue;
      ctx.fillStyle = FLOOR[id];
      ctx.fillRect(c * TILE, r * TILE, w * TILE, h * TILE);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(c * TILE, r * TILE, w * TILE, h * TILE);
      }
    }
  }
  // The wall you see face on at the top of each room.
  for (const [x1, y, x2] of FACES) {
    if (!overlaps(view, x1, y - 40, x2 - x1, 40)) continue;
    ctx.fillStyle = "#566072";
    ctx.fillRect(x1, y - HULL * 2, x2 - x1, HULL * 2);
    ctx.fillStyle = "#3d4454";
    ctx.fillRect(x1, y - 5, x2 - x1, 5);
  }
  ctx.strokeStyle = "#1b1f27";
  ctx.lineWidth = 5;
  ctx.lineCap = "square";
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of WALLS) {
    if (!overlaps(view, Math.min(x1, x2) - 5, Math.min(y1, y2) - 5, Math.abs(x2 - x1) + 10, Math.abs(y2 - y1) + 10)) continue;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();

  // Room names, on the floor.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 44px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  for (const id of ROOM_IDS) {
    const [c, r, w, h] = ZONES[id].boxes[0];
    const x = (c + w / 2) * TILE;
    const y = (r + h / 2) * TILE + (id === "cafeteria" ? 200 : 0);
    if (overlaps(view, x - 200, y - 30, 400, 60)) ctx.fillText(ZONES[id].name, x, y);
  }

  drawProps(ctx, view, o);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawProps(ctx: CanvasRenderingContext2D, view: Rect, o: ShipOptions) {
  const near = (p: Point, pad = 150) => overlaps(view, p.x - pad, p.y - pad, pad * 2, pad * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#1b1f27";

  // The cafeteria table and its button.
  const b = SPOTS.button;
  if (near(b)) {
    ctx.fillStyle = "#c3cad6";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 6, 100, 78, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8e98a8";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 4, 30, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e03131";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, 20, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.beginPath();
    ctx.ellipse(b.x - 6, b.y - 5, 7, 4, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Admin's map table.
  const a = SPOTS.table;
  if (near(a)) {
    roundRect(ctx, a.x - 110, a.y - 45, 220, 90, 14);
    ctx.fillStyle = "#2f7d52";
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(190, 255, 210, 0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x - 90, a.y - 30, 70, 30);
    ctx.strokeRect(a.x - 10, a.y - 30, 40, 55);
    ctx.strokeRect(a.x + 40, a.y - 10, 50, 30);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#1b1f27";
  }
  // Security's screens.
  const s = SPOTS.cameras;
  if (near(s)) {
    roundRect(ctx, s.x - 60, s.y - 40, 120, 60, 8);
    ctx.fillStyle = "#4a5263";
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = (Math.floor(o.t / 700) + i) % 5 === 0 ? "#74c0fc" : "#339af0";
      ctx.fillRect(s.x - 52 + i * 26, s.y - 32, 22, 18);
    }
  }
  // The lights' panel.
  const l = SPOTS.lights;
  if (near(l)) {
    roundRect(ctx, l.x - 24, l.y - 36, 48, 56, 6);
    ctx.fillStyle = o.sabotage === "lights" && Math.floor(o.t / 400) % 2 ? "#e03131" : "#6c7589";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffd43b";
    ctx.beginPath();
    ctx.moveTo(l.x + 4, l.y - 28);
    ctx.lineTo(l.x - 10, l.y - 4);
    ctx.lineTo(l.x, l.y - 4);
    ctx.lineTo(l.x - 4, l.y + 12);
    ctx.lineTo(l.x + 10, l.y - 10);
    ctx.lineTo(l.x, l.y - 10);
    ctx.closePath();
    ctx.fill();
  }
  // The reactor's core and its hand scanners.
  const core = { x: 2 * TILE, y: 19 * TILE };
  if (near(core, 200)) {
    const glow = o.sabotage === "reactor" ? (Math.sin(o.t / 120) + 1) / 2 : 0.3;
    ctx.fillStyle = `rgba(${o.sabotage === "reactor" ? "255, 80, 80" : "120, 220, 255"}, ${0.25 + glow * 0.35})`;
    ctx.beginPath();
    ctx.arc(core.x, core.y, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a5263";
    ctx.beginPath();
    ctx.arc(core.x, core.y, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  for (const spot of SPOTS.reactor) {
    if (!near(spot)) continue;
    roundRect(ctx, spot.x - 26, spot.y - 26, 52, 52, 8);
    ctx.fillStyle = o.sabotage === "reactor" && Math.floor(o.t / 300) % 2 ? "#ff6b6b" : "#4dabf7";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y + 6, 10, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let f = -2; f <= 2; f++) ctx.fillRect(spot.x + f * 5 - 2, spot.y - 14 + Math.abs(f) * 3, 4, 12);
  }

  // Vents.
  for (const vent of VENTS) {
    if (!near(vent)) continue;
    const lit = o.vents || o.inVent === vent.id;
    roundRect(ctx, vent.x - 26, vent.y - 17, 52, 34, 5);
    ctx.fillStyle = lit ? "#495063" : "#3a404d";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1b1f27";
    for (let i = 0; i < 4; i++) ctx.fillRect(vent.x - 19 + i * 11, vent.y - 11, 5, 22);
    if (lit && o.inVent === null) {
      ctx.strokeStyle = "rgba(255, 90, 90, 0.7)";
      ctx.lineWidth = 2;
      roundRect(ctx, vent.x - 31, vent.y - 22, 62, 44, 8);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#1b1f27";
    }
  }
  if (o.inVent) {
    const from = VENT_BY_ID.get(o.inVent)!;
    for (const to of from.links) {
      const target = VENT_BY_ID.get(to)!;
      const angle = Math.atan2(target.y - from.y, target.x - from.x);
      drawArrow(ctx, from.x + Math.cos(angle) * 90, from.y + Math.sin(angle) * 90, angle, 26, "#ff6b6b");
    }
  }

  // Consoles, and a mark over each of your tasks.
  for (const task of TASKS) {
    if (!near(task)) continue;
    const mine = o.tasks.has(task.id);
    if (task.kind === "scan") {
      ctx.fillStyle = "rgba(64, 192, 87, 0.35)";
      ctx.beginPath();
      ctx.ellipse(task.x, task.y + 10, 42, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mine ? "#ffd43b" : "#2b8a3e";
      ctx.stroke();
      ctx.strokeStyle = "#1b1f27";
    } else {
      roundRect(ctx, task.x - 20, task.y - 18, 40, 32, 5);
      ctx.fillStyle = "#6c7589";
      ctx.fill();
      ctx.strokeStyle = mine ? "#ffd43b" : "#1b1f27";
      ctx.stroke();
      ctx.strokeStyle = "#1b1f27";
      ctx.fillStyle = "#2c3e50";
      ctx.fillRect(task.x - 13, task.y - 11, 26, 14);
      ctx.fillStyle = "#63e6be";
      ctx.fillRect(task.x - 10, task.y - 8, 8 + ((Math.floor(o.t / 500) + task.x) % 3) * 4, 3);
    }
    if (mine) {
      const bob = Math.sin(o.t / 250 + task.x) * 5;
      ctx.fillStyle = "#ffd43b";
      ctx.strokeStyle = "#1b1f27";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(task.x - 11, task.y - 58 + bob);
      ctx.lineTo(task.x + 11, task.y - 58 + bob);
      ctx.lineTo(task.x, task.y - 36 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 4;
    }
  }
}

export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, size * 0.75);
  ctx.lineTo(-size * 0.25, 0);
  ctx.lineTo(-size * 0.6, -size * 0.75);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1b1f27";
  ctx.stroke();
  ctx.restore();
}

/* ----------------------------------------------------------------- beans */

// The same crewmate as ./Bean.tsx, 44 by 48, facing right.
const PACK = new Path2D("M6.5 17h2a3.5 3.5 0 0 1 3.5 3.5v10a3.5 3.5 0 0 1-3.5 3.5h-2A3.5 3.5 0 0 1 3 30.5v-10A3.5 3.5 0 0 1 6.5 17Z");
const BODY = new Path2D("M10 15a12 12 0 0 1 24 0V40a4 4 0 0 1-4 4h-4a2 2 0 0 1-2-2v-3h-4v3a2 2 0 0 1-2 2h-4a4 4 0 0 1-4-4Z");
const VISOR = new Path2D("M25.5 10h8a5.5 5.5 0 0 1 0 11h-8a5.5 5.5 0 0 1 0-11Z");
const DEAD_PACK = new Path2D("M6 28h3a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3Z");
const DEAD_BODY = new Path2D("M10 28H34V40a4 4 0 0 1-4 4h-4a2 2 0 0 1-2-2v-3h-4v3a2 2 0 0 1-2 2h-4a4 4 0 0 1-4-4Z");
const BEAN_SCALE = 1.25;

export interface BeanLook {
  color: number;
  f?: number;
  /** Walking, and how far through a step. */
  m?: number;
  t?: number;
  dead?: boolean;
  ghost?: boolean;
  name?: string;
  nameColor?: string;
  scanning?: boolean;
}

/** A crewmate standing at (x, y): their feet at the bottom of the square they take up. */
export function drawBean(ctx: CanvasRenderingContext2D, x: number, y: number, look: BeanLook) {
  const fill = COLORS[look.color % COLORS.length].hex;
  const t = look.t ?? 0;
  const walk = look.m ? Math.sin(t / 55) : 0;
  const feet = y + RADIUS;
  ctx.save();
  if (!look.ghost) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.beginPath();
    ctx.ellipse(x, feet, 24, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.scanning) {
    const k = (t / 900) % 1;
    ctx.strokeStyle = `rgba(64, 255, 120, ${0.8 - k * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, feet - k * 60, 30, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(64, 255, 120, 0.12)";
    ctx.fillRect(x - 30, feet - 62, 60, 62);
  }
  ctx.translate(x, feet - (look.ghost ? 10 + Math.sin(t / 300) * 5 : Math.abs(walk) * 4));
  if (look.m) ctx.rotate(walk * 0.07);
  ctx.scale((look.f ?? 1) < 0 ? -BEAN_SCALE : BEAN_SCALE, BEAN_SCALE);
  ctx.translate(-22, -44);
  if (look.ghost) ctx.globalAlpha = 0.5;
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#15171a";
  if (look.dead) {
    ctx.fillStyle = darker(fill);
    ctx.fill(DEAD_PACK);
    ctx.stroke(DEAD_PACK);
    ctx.fillStyle = fill;
    ctx.fill(DEAD_BODY);
    ctx.stroke(DEAD_BODY);
    ctx.fillStyle = "#f1f3f5";
    ctx.fillRect(19.5, 19, 5, 9);
    ctx.beginPath();
    ctx.arc(20.5, 18.5, 2.4, 0, Math.PI * 2);
    ctx.arc(23.5, 18.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = darker(fill);
    ctx.fill(PACK);
    ctx.stroke(PACK);
    ctx.fillStyle = fill;
    ctx.fill(BODY);
    ctx.stroke(BODY);
    ctx.fillStyle = "#95cadc";
    ctx.fill(VISOR);
    ctx.stroke(VISOR);
    ctx.fillStyle = "#e7f5fa";
    ctx.fillRect(26, 12.2, 7, 2.2);
  }
  ctx.restore();
  if (look.name) {
    ctx.font = "700 17px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.lineJoin = "round";
    const top = feet - 44 * BEAN_SCALE - 10 - (look.ghost ? 10 : 0);
    ctx.globalAlpha = look.ghost ? 0.6 : 1;
    ctx.strokeText(look.name, x, top);
    ctx.fillStyle = look.nameColor ?? "#ffffff";
    ctx.fillText(look.name, x, top);
    ctx.globalAlpha = 1;
  }
}

/* ---------------------------------------------------------------- scene */

/** Where the ship's drawn: `scale` screen pixels to a unit, the view centred on (cx, cy). */
export function transformFor(w: number, h: number, cx: number, cy: number) {
  // Closer in on a phone held upright, so everyone isn't tiny.
  const scale = Math.max(Math.min(w, h) / VIEW, Math.max(w, h) / VIEW_LONG);
  return { scale, ox: w / 2 - cx * scale, oy: h / 2 - cy * scale };
}

interface Figure {
  y: number;
  draw: () => void;
}

// Each stage owns its fog canvas; only movement or a view change alters its mask.
const fogViews = new WeakMap<HTMLCanvasElement, string>();

/** The game as you see it, with the dark beyond what you can see. */
export function drawScene(ctx: CanvasRenderingContext2D, fog: HTMLCanvasElement, e: Engine, w: number, h: number, dpr: number, t: number) {
  const view = e.view;
  const mine = e.mine;
  const game = view?.game;
  if (!view || !mine || !game) return;
  const me = e.pos;
  const players = new Map<string, PlayerView>(view.players.map((p) => [p.id, p]));
  const { scale, ox, oy } = transformFor(w, h, me.x, me.y);
  const rect: Rect = { x: -ox / scale, y: -oy / scale, w: w / scale, h: h / scale };
  const range = e.range;
  const sabotage = game.sabotage?.kind ?? null;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawStars(ctx, w, h, me.x, me.y);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  const todo = new Set(mine.tasks.filter((x) => !x.done).map((x) => x.id));
  drawShip(ctx, rect, { tasks: todo, sabotage, vents: mine.impostor && mine.alive, inVent: e.inVent?.id ?? null, t });

  const figures: Figure[] = [];
  const mates = new Set(mine.mates);
  for (const body of mine.bodies) {
    if (range !== Infinity && !canSee(me, body, range)) continue;
    const who = players.get(body.victim);
    figures.push({ y: body.y - 1, draw: () => drawBean(ctx, body.x, body.y, { color: who?.color ?? 0, dead: true, t }) });
  }
  const scanning = new Set(mine.scanning);
  for (const p of e.visible) {
    const who = players.get(p.id);
    if (!who) continue;
    figures.push({
      y: p.y,
      draw: () =>
        drawBean(ctx, p.x, p.y, {
          color: who.color,
          f: p.f,
          m: p.m,
          t: t + p.x,
          ghost: p.ghost,
          name: who.name,
          nameColor: mates.has(p.id) ? "#ff6b6b" : undefined,
          scanning: scanning.has(p.id),
        }),
    });
  }
  if (!e.inVent) {
    const self = players.get(e.me);
    figures.push({
      y: me.y + 0.5,
      draw: () =>
        drawBean(ctx, me.x, me.y, {
          color: self?.color ?? 0,
          f: e.facing,
          m: e.moving ? 1 : 0,
          t,
          ghost: !mine.alive,
          name: self?.name,
          nameColor: mine.impostor ? "#ff6b6b" : undefined,
          scanning: scanning.has(e.me),
        }),
    });
  }
  figures.sort((a, b) => a.y - b.y);
  for (const f of figures) f.draw();

  // Vent puffs.
  e.puffs = e.puffs.filter((p) => t - p.t < 600);
  for (const p of e.puffs) {
    const k = (t - p.t) / 600;
    ctx.fillStyle = `rgba(200, 205, 215, ${0.6 * (1 - k)})`;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * 40 * k, p.y + Math.sin(a) * 26 * k, 10 + 8 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The dark: everything but what you can see from where you stand.
  if (range !== Infinity) {
    const f = fog.getContext("2d");
    if (f) {
      const key = [me.x, me.y, range, mine.dark, w, h, dpr, ctx.canvas.width, ctx.canvas.height].join("|");
      if (fogViews.get(fog) !== key) {
        if (fog.width !== ctx.canvas.width || fog.height !== ctx.canvas.height) {
          fog.width = ctx.canvas.width;
          fog.height = ctx.canvas.height;
        }
        f.setTransform(1, 0, 0, 1, 0, 0);
        f.globalCompositeOperation = "source-over";
        f.clearRect(0, 0, fog.width, fog.height);
        f.fillStyle = mine.dark ? "rgba(3, 4, 8, 0.97)" : "rgba(5, 7, 13, 0.82)";
        f.fillRect(0, 0, fog.width, fog.height);
        f.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
        f.globalCompositeOperation = "destination-out";
        const glow = f.createRadialGradient(me.x, me.y, range * 0.62, me.x, me.y, range);
        glow.addColorStop(0, "rgba(0, 0, 0, 1)");
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        f.fillStyle = glow;
        const shape = visibility(me, range);
        f.beginPath();
        shape.forEach((p, i) => (i ? f.lineTo(p.x, p.y) : f.moveTo(p.x, p.y)));
        f.closePath();
        f.fill();
        fogViews.set(fog, key);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(fog, 0, 0);
    }
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(90, 140, 255, 0.08)";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  // Arrows at the edge of the screen to anything you're meant to go to.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const goals: { p: Point; color: string }[] = [];
  if (sabotage === "lights" && mine.alive) goals.push({ p: SPOTS.lights, color: "#ff6b6b" });
  if (sabotage === "reactor" && mine.alive) for (const spot of SPOTS.reactor) goals.push({ p: spot, color: "#ff6b6b" });
  for (const task of TASKS) if (todo.has(task.id) && (!mine.impostor || mine.alive)) goals.push({ p: task, color: "#ffd43b" });
  for (const goal of goals) {
    const sx = goal.p.x * scale + ox;
    const sy = goal.p.y * scale + oy;
    const pad = 28;
    if (sx > pad && sx < w - pad && sy > pad + 40 && sy < h - pad) continue;
    const angle = Math.atan2(sy - h / 2, sx - w / 2);
    const k = Math.min((w / 2 - pad) / Math.abs(Math.cos(angle) || 1e-6), (h / 2 - pad - 20) / Math.abs(Math.sin(angle) || 1e-6));
    drawArrow(ctx, w / 2 + Math.cos(angle) * k, h / 2 + Math.sin(angle) * k, angle, 13, goal.color);
  }
}

/** One of security's cameras: the ship as it is in that rectangle, everyone in it and all, lit. */
export function drawCamera(ctx: CanvasRenderingContext2D, e: Engine, camera: Rect, w: number, h: number, dpr: number, t: number) {
  const view = e.view;
  const mine = e.mine;
  if (!view || !mine) return;
  const players = new Map<string, PlayerView>(view.players.map((p) => [p.id, p]));
  const scale = Math.min(w / camera.w, h / camera.h);
  const ox = (w - camera.w * scale) / 2 - camera.x * scale;
  const oy = (h - camera.h * scale) / 2 - camera.y * scale;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  drawShip(ctx, camera, { tasks: new Set(), sabotage: view.game?.sabotage?.kind ?? null, vents: false, inVent: null, t });
  const inside = (p: Point) => p.x >= camera.x - 40 && p.x < camera.x + camera.w + 40 && p.y >= camera.y - 40 && p.y < camera.y + camera.h + 60;
  const figures: Figure[] = [];
  for (const body of mine.bodies) {
    if (inside(body)) figures.push({ y: body.y, draw: () => drawBean(ctx, body.x, body.y, { color: players.get(body.victim)?.color ?? 0, dead: true }) });
  }
  const hidden = e.hiddenIds();
  for (const p of e.shown) {
    const who = players.get(p.id);
    if (who && !p.ghost && !hidden.has(p.id) && inside(p)) figures.push({ y: p.y, draw: () => drawBean(ctx, p.x, p.y, { color: who.color, f: p.f, m: p.m, t: t + p.x, name: who.name }) });
  }
  if (mine.alive && !e.inVent && inside(e.pos)) figures.push({ y: e.pos.y, draw: () => drawBean(ctx, e.pos.x, e.pos.y, { color: players.get(e.me)?.color ?? 0, f: e.facing, m: e.moving ? 1 : 0, t, name: players.get(e.me)?.name }) });
  figures.sort((a, b) => a.y - b.y);
  for (const f of figures) f.draw();
  // Scan lines, so it looks like a camera.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
  for (let y = (t / 40) % 4; y < h; y += 4) ctx.fillRect(0, y, w, 1.5);
}

