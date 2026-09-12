/**
 * A 5x7 bitmap alphabet, and a way to turn a word into a stencil the field can
 * read. The browser can rasterise text with a canvas; the server cannot without
 * carrying a font file around, and a domain name only needs forty shapes.
 */

import type { Mask } from "./sim.ts";

const W = 5;
const H = 7;

const GLYPHS: Record<string, string[]> = {
  "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  "C": [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  "G": [".####", "#....", "#....", "#..##", "#...#", "#...#", ".####"],
  "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "I": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  "J": ["####.", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
  "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  "W": ["#...#", "#...#", "#...#", "#...#", "#.#.#", "##.##", "#...#"],
  "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "_": [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

/** Every glyph is seven rows of five. `checkFont` proves it. */
const rowsOf = (char: string): string[] => GLYPHS[char] ?? [];

/** Throws if a glyph was typed wrong. Called by the project's checks. */
export function checkFont() {
  for (const [char, rows] of Object.entries(GLYPHS)) {
    if (rows.length !== H) throw new Error(`glyph ${char} has ${rows.length} rows, expected ${H}`);
    for (const row of rows) {
      if (row.length !== W) throw new Error(`glyph ${char} has a row of ${row.length}, expected ${W}`);
      if (!/^[#.]+$/.test(row)) throw new Error(`glyph ${char} has something other than # and . in it`);
    }
  }
}

export const SUPPORTED = new Set(Object.keys(GLYPHS));

/**
 * Draws `text` into a grid of `cols` by `rows`, as large as it will go. Returns
 * null when there is nothing to draw or no room to draw it.
 */
export function textMask(text: string, cols: number, rows: number): Mask | null {
  const letters = [...text.toUpperCase()].filter((c) => SUPPORTED.has(c));
  while (letters.length && letters[0] === " ") letters.shift();
  while (letters.length && letters[letters.length - 1] === " ") letters.pop();
  if (!letters.length || cols < W || rows < H) return null;

  // One blank column between letters, none after the last.
  const naturalWidth = letters.length * (W + 1) - 1;
  const scale = Math.max(1, Math.min(Math.floor((cols * 0.86) / naturalWidth), Math.floor((rows * 0.55) / H)));

  const width = naturalWidth * scale;
  const height = H * scale;
  const left = Math.round((cols - width) / 2);
  const top = Math.round((rows - height) / 2);

  const data = new Float32Array(cols * rows);
  letters.forEach((char, index) => {
    const glyph = rowsOf(char);
    const originX = left + index * (W + 1) * scale;
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        if (glyph[gy]?.[gx] !== "#") continue;
        for (let sy = 0; sy < scale; sy++) {
          const y = top + gy * scale + sy;
          if (y < 0 || y >= rows) continue;
          for (let sx = 0; sx < scale; sx++) {
            const x = originX + gx * scale + sx;
            if (x < 0 || x >= cols) continue;
            data[y * cols + x] = 1;
          }
        }
      }
    }
  });

  return { cols, rows, data };
}
