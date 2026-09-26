/**
 * Comparing a guess with the word. Case, accents, punctuation and spacing
 * don't matter, so "Ice-cream", "icecream" and "ice cream" all count.
 */

/** Lowercase letters and digits separated by single spaces. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Letters and digits only, for comparing words however they're spaced. */
const squash = (text: string) => normalize(text).replace(/ /g, "");

export function sameWord(guess: string, word: string): boolean {
  const target = squash(word);
  return target.length > 0 && squash(guess) === target;
}

/** Edit distance, for spotting a guess that's one slip away. Both strings are short. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/** One letter off, for a word long enough that that's still a real guess. */
export function isClose(guess: string, word: string): boolean {
  const target = squash(word);
  const attempt = squash(guess);
  return target.length >= 4 && attempt !== target && editDistance(attempt, target) === 1;
}

/** Whether a message gives the word away, even inside a sentence. */
export function mentions(text: string, word: string): boolean {
  const target = normalize(word);
  if (!target) return false;
  if (` ${normalize(text)} `.includes(` ${target} `)) return true;
  // "icecream" inside "icecreamyum", but not "ant" inside "want".
  const squashed = squash(word);
  return squashed.length >= 5 && squash(text).includes(squashed);
}

/**
 * The word as guessers see it: "_" for each letter still hidden, the letters
 * given as hints, and spaces and hyphens as they are.
 */
export function maskWord(word: string, shown: ReadonlySet<number>): string {
  return Array.from(word)
    .map((ch, i) => (/[\p{L}\p{N}]/u.test(ch) && !shown.has(i) ? "_" : ch))
    .join("");
}

/** Positions of the letters in a word, the ones a hint can uncover. */
export function letterPositions(word: string): number[] {
  const positions: number[] = [];
  Array.from(word).forEach((ch, i) => {
    if (/[\p{L}\p{N}]/u.test(ch)) positions.push(i);
  });
  return positions;
}

/** Tidies a custom word: lowercase, single spaces, 2 to 30 characters with at least two letters. */
export function cleanWord(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const word = value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} '-]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (word.length < 2 || word.length > 30) return null;
  return squash(word).length >= 2 ? word : null;
}
