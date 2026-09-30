import { HEIGHT, WIDTH, type Op } from "@/lib/draw/ink";
import { Painter } from "./sketch";

/** Render the operations, rather than capture a replay halfway through a stroke. */
export function drawingImage(ops: readonly Op[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  new Painter(canvas).replay(ops);
  return canvas;
}

export interface ImageEntry {
  author: string;
  color: string;
  work: { text: string } | { ops: readonly Op[] };
}

/** Wrap at words, splitting a long unbroken word when it would run off the image. */
function linesFor(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const joined = line ? `${line} ${word}` : word;
    if (ctx.measureText(joined).width <= width) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const letter of word) {
      if (line && ctx.measureText(line + letter).width > width) {
        lines.push(line);
        line = "";
      }
      line += letter;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** One complete chain, with names and text kept beside the drawings. */
export async function chainImage(title: string, entries: readonly ImageEntry[]): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const family = getComputedStyle(document.body).fontFamily;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH + 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser can't make an image");
  ctx.font = `24px ${family}`;
  const rows = entries.map((entry) => ({
    ...entry,
    lines: "text" in entry.work ? linesFor(ctx, entry.work.text, WIDTH - 32) : [],
  }));
  canvas.height = 160 + rows.reduce((height, row) => height + 64 + ("ops" in row.work ? HEIGHT : Math.max(1, row.lines.length) * 34 + 32), 0);

  ctx.fillStyle = "#f6f4ee";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#1b1a17";
  ctx.font = `600 30px ${family}`;
  ctx.fillText(title, 48, 40, WIDTH);
  let y = 104;
  for (const row of rows) {
    ctx.fillStyle = row.color;
    ctx.beginPath();
    ctx.arc(54, y + 10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6e6b63";
    ctx.font = `500 18px ${family}`;
    ctx.fillText(`${row.author} ${"text" in row.work ? "wrote" : "drew"}`, 70, y, WIDTH - 22);
    y += 32;
    if ("ops" in row.work) {
      ctx.drawImage(drawingImage(row.work.ops), 48, y);
      y += HEIGHT;
    } else {
      const height = Math.max(1, row.lines.length) * 34 + 32;
      ctx.fillStyle = "#eae7df";
      ctx.fillRect(48, y, WIDTH, height);
      ctx.fillStyle = "#1b1a17";
      ctx.font = `24px ${family}`;
      row.lines.forEach((line, index) => ctx.fillText(line, 64, y + 16 + index * 34));
      y += height;
    }
    y += 32;
  }
  ctx.fillStyle = "#6e6b63";
  ctx.font = `16px ${family}`;
  ctx.fillText(`phone · ${window.location.host}`, 48, y + 8);
  return canvas;
}

/** Keep a player's name useful in a filename, without path or control characters. */
export function imageName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "chain";
}

export async function downloadImage(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((image) => image ? resolve(image) : reject(new Error("couldn't make that image; try again")), "image/png");
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.png`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser time to start the download before releasing the image.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
