import { COLS, ROWS, type Dir } from "@/lib/snake/game";

/**
 * Drawing a snake: the chequered field, the apples, and the snake itself,
 * round-ended with eyes that look where it's going. In cells, under a
 * transform, so the same drawing does your board and the little ones of
 * whoever you're racing.
 */

export interface SnakeLook {
  body: readonly number[];
  dir: Dir;
  apple: number;
  gold: number;
  /** How far the golden apple's got left, 0 to 1. */
  goldLeft?: number;
  dead: boolean;
  color?: string;
  /** From 0 to 1 through a step: the head slides into its next cell. */
  t?: number;
}

export const SNAKE_COLORS = ["#4a7cf0", "#e0457b", "#8e5bd9", "#f08a2c", "#2bb5a8", "#d9b21c", "#6b6b6b", "#c94a3a"];

const at = (c: number) => [c % COLS, Math.floor(c / COLS)] as const;

function apple(ctx: CanvasRenderingContext2D, c: number, gold: boolean, pulse: number) {
  const [x, y] = at(c);
  const r = 0.36 + (gold ? pulse * 0.04 : 0);
  ctx.fillStyle = gold ? "#f7c52b" : "#e7471d";
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.54, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.beginPath();
  ctx.arc(x + 0.38, y + 0.42, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5b3a1a";
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y + 0.2);
  ctx.lineTo(x + 0.55, y + 0.08);
  ctx.stroke();
  ctx.fillStyle = "#4caf50";
  ctx.beginPath();
  ctx.ellipse(x + 0.66, y + 0.14, 0.12, 0.06, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

/** A board: `size` pixels a cell, from the canvas's top left. */
export function drawBoard(ctx: CanvasRenderingContext2D, look: SnakeLook, size: number, time: number) {
  ctx.save();
  ctx.scale(size, size);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (r + c) % 2 ? "#a2d149" : "#aad751";
      ctx.fillRect(c, r, 1, 1);
    }
  }
  const pulse = (Math.sin(time / 120) + 1) / 2;
  if (look.apple >= 0) apple(ctx, look.apple, false, 0);
  if (look.gold >= 0) {
    // A ring that runs down as the golden apple's time does.
    const [x, y] = at(look.gold);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.54, 0.47, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (look.goldLeft ?? 1));
    ctx.stroke();
    apple(ctx, look.gold, true, pulse);
  }

  const body = look.body;
  if (body.length) {
    const color = look.color ?? SNAKE_COLORS[0];
    // The head slides into its cell as the step goes by, and the tail out of its.
    const slide = Math.min(1, look.t ?? 1);
    const points = body.map((c) => {
      const [x, y] = at(c);
      return [x + 0.5, y + 0.5] as [number, number];
    });
    if (points.length > 1 && slide < 1) {
      const [hx, hy] = points[0];
      const [nx, ny] = points[1];
      points[0] = [nx + (hx - nx) * slide, ny + (hy - ny) * slide];
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = look.dead ? "#8a8f98" : color;
    ctx.lineWidth = 0.78;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (points.length === 1) ctx.lineTo(points[0][0] + 0.01, points[0][1]);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 0.3;
    ctx.stroke();
    // Eyes, looking the way it's going.
    const [hx, hy] = points[0];
    const dx = [0, 1, 0, -1][look.dir];
    const dy = [-1, 0, 1, 0][look.dir];
    for (const side of [-1, 1]) {
      const ex = hx + dx * 0.12 + -dy * side * 0.2;
      const ey = hy + dy * 0.12 + dx * side * 0.2;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ex, ey, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1b1a17";
      if (look.dead) {
        ctx.fillRect(ex - 0.09, ey - 0.02, 0.18, 0.04);
      } else {
        ctx.beginPath();
        ctx.arc(ex + dx * 0.05, ey + dy * 0.05, 0.075, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}
