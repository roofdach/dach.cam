/** A source of numbers in [0, 1). */
export type Random = () => number;

/**
 * A repeatable random sequence from a string, so everyone playing the daily
 * gets the same places. cyrb128 spreads the string over 128 bits and sfc32
 * turns them into a sequence; both are small, fast and well mixed.
 */
export function seededRandom(seed: string): Random {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;

  let a = h1 | 0;
  let b = h2 | 0;
  let c = h3 | 0;
  let d = h4 | 0;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // The first few outputs still echo the seed.
  for (let i = 0; i < 12; i++) next();
  return next;
}

/** Index into `cumulative` (running totals of weights) chosen in proportion to each weight. */
export function pickCumulative(cumulative: ArrayLike<number>, random: Random): number {
  const total = cumulative[cumulative.length - 1];
  const target = random() * total;
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] > target) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Running totals of a list of weights. */
export function cumulate(weights: readonly number[]): Float64Array {
  const out = new Float64Array(weights.length);
  let sum = 0;
  weights.forEach((weight, i) => (out[i] = sum += weight));
  return out;
}

/** A random id from an alphabet, drawn from the platform's secure source. */
export function randomId(length: number, alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = "";
  // Rejection sampling keeps every letter equally likely.
  const limit = 256 - (256 % alphabet.length);
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    if (bytes[i] < limit) out += alphabet[bytes[i] % alphabet.length];
  }
  return out.length === length ? out : randomId(length, alphabet);
}
