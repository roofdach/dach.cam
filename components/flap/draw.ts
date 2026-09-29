import { BIRD_R, Course, GROUND, HEIGHT, PIPE_W, WIDTH, pipesOnScreen, scroll } from "@/lib/flap/game";

/**
 * Drawing a flappy bird: the sky, the pipes, the ground going by, and the
 * birds, yours and anyone you're racing. In the game's own 288 by 512
 * pixels, under a transform, so it's sharp at any size.
 */

export interface BirdLook {
  y: number;
  vy: number;
  /** Where it is along the screen: yours is always at BIRD_X. */
  x: number;
  tick: number;
  body: string;
  alpha?: number;
  name?: string;
  dead?: boolean;
}

export const BIRD_COLORS = ["#f8c630", "#5ec8f2", "#f27ea9", "#7bd672", "#b98cf2", "#f29b54", "#e8e8e8", "#f25454"];

const CLOUDS = Array.from({ length: 7 }, (_, i) => ({ x: i * 97 + ((i * 53) % 40), y: 290 + ((i * 37) % 60), r: 22 + ((i * 19) % 18) }));

function sky(ctx: CanvasRenderingContext2D, tick: number) {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, "#3fb4c7");
  g.addColorStop(1, "#9fe2e6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, GROUND);
  // Clouds, then a city, drifting slower than the pipes.
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  const cloudShift = (scroll(tick) * 0.15) % (WIDTH + 100);
  for (const c of CLOUDS) {
    const x = ((c.x - cloudShift + WIDTH + 100) % (WIDTH + 100)) - 50;
    ctx.beginPath();
    ctx.arc(x, c.y, c.r, 0, Math.PI * 2);
    ctx.arc(x + c.r * 0.9, c.y + 6, c.r * 0.8, 0, Math.PI * 2);
    ctx.arc(x - c.r * 0.9, c.y + 8, c.r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  const cityShift = (scroll(tick) * 0.3) % 48;
  ctx.fillStyle = "#b5e8c9";
  for (let i = -1; i < WIDTH / 48 + 2; i++) {
    const x = i * 48 - cityShift;
    const h = 30 + ((i * 29 + 1000) % 5) * 9;
    ctx.fillRect(x, GROUND - 22 - h, 30, h + 22);
    ctx.fillRect(x + 30, GROUND - 22 - h * 0.6, 14, h * 0.6 + 22);
  }
  ctx.fillStyle = "#7fd48f";
  for (let i = -1; i < WIDTH / 36 + 2; i++) {
    const x = i * 36 - ((scroll(tick) * 0.5) % 36);
    ctx.beginPath();
    ctx.arc(x, GROUND - 4, 22, Math.PI, 0);
    ctx.fill();
  }
}

function pipe(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, up: boolean) {
  ctx.fillStyle = "#74bf2e";
  ctx.strokeStyle = "#3d6b17";
  ctx.lineWidth = 2;
  ctx.fillRect(x + 2, y, PIPE_W - 4, h);
  ctx.strokeRect(x + 2, y, PIPE_W - 4, h);
  ctx.fillStyle = "#9be04e";
  ctx.fillRect(x + 6, y, 6, h);
  const capY = up ? y + h - 24 : y;
  ctx.fillStyle = "#74bf2e";
  ctx.fillRect(x - 2, capY, PIPE_W + 4, 24);
  ctx.strokeRect(x - 2, capY, PIPE_W + 4, 24);
  ctx.fillStyle = "#9be04e";
  ctx.fillRect(x + 2, capY + 2, 6, 20);
}

function ground(ctx: CanvasRenderingContext2D, tick: number) {
  ctx.fillStyle = "#ded895";
  ctx.fillRect(0, GROUND, WIDTH, HEIGHT - GROUND);
  ctx.fillStyle = "#73bf2e";
  ctx.fillRect(0, GROUND, WIDTH, 12);
  ctx.fillStyle = "#5c9e22";
  const shift = scroll(tick) % 16;
  for (let x = -16; x < WIDTH + 16; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x - shift, GROUND + 12);
    ctx.lineTo(x - shift + 8, GROUND);
    ctx.lineTo(x - shift + 14, GROUND);
    ctx.lineTo(x - shift + 6, GROUND + 12);
    ctx.fill();
  }
  ctx.fillStyle = "#c9c07a";
  ctx.fillRect(0, GROUND + 12, WIDTH, 3);
}

export function drawBird(ctx: CanvasRenderingContext2D, b: BirdLook) {
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.translate(b.x, b.y);
  ctx.rotate(Math.max(-0.45, Math.min(1.4, b.vy * 0.09)));
  const outline = "#3a2a14";
  ctx.lineWidth = 2;
  ctx.strokeStyle = outline;
  ctx.fillStyle = b.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, BIRD_R + 5, BIRD_R, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // The wing beats while it flies.
  const beat = b.dead ? 0 : Math.sin(b.tick * 0.45) * 4;
  ctx.fillStyle = "#fff4d6";
  ctx.beginPath();
  ctx.ellipse(-6, 2 + beat, 7, 4.5, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(7, -4, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = outline;
  if (b.dead) {
    ctx.fillRect(4, -5, 6, 1.6);
    ctx.fillRect(6.2, -7.2, 1.6, 6);
  } else {
    ctx.beginPath();
    ctx.arc(8.5, -4, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f26b3a";
  ctx.beginPath();
  ctx.moveTo(10, 1);
  ctx.lineTo(21, 3);
  ctx.lineTo(10, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (b.name) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, (b.alpha ?? 1) + 0.25);
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    // Below the bird when it's up against the top.
    const y = b.y - BIRD_R - 8 < 14 ? b.y + BIRD_R + 16 : b.y - BIRD_R - 8;
    ctx.strokeText(b.name, b.x, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(b.name, b.x, y);
    ctx.restore();
  }
}

export function drawScore(ctx: CanvasRenderingContext2D, score: number, y = 64) {
  ctx.save();
  ctx.font = "900 44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#3a2a14";
  ctx.strokeText(String(score), WIDTH / 2, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(score), WIDTH / 2, y);
  ctx.restore();
}

/** The world at a tick: sky, pipes and ground. */
export function drawWorld(ctx: CanvasRenderingContext2D, course: Course, tick: number) {
  sky(ctx, tick);
  const [first, last] = pipesOnScreen(tick);
  const left = scroll(tick);
  for (let i = first; i <= last; i++) {
    const p = course.pipe(i);
    const x = p.x - left;
    pipe(ctx, x, -4, p.top + 4, true);
    pipe(ctx, x, p.bottom, GROUND - p.bottom, false);
  }
  ground(ctx, tick);
}

