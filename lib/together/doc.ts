/**
 * The document model behind `together`. It is a small sequence CRDT: every
 * character gets a fractional index that sorts it between its neighbours, so
 * two people typing at once converge on the same text without a server deciding
 * who won.
 */

/** Ordered so that plain string comparison matches digit order. */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const FIRST = DIGITS[0];

/**
 * A key strictly between `a` and `b`, where `null` means "before everything" or
 * "after everything". Keys never end in the lowest digit, which keeps
 * comparison unambiguous for keys of different lengths.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`keys out of order: ${a} >= ${b}`);
  }
  if (a?.endsWith(FIRST) || b?.endsWith(FIRST)) {
    throw new Error("a key must not end in the lowest digit");
  }

  if (b !== null) {
    let shared = 0;
    while ((a?.[shared] ?? FIRST) === b[shared]) shared++;
    if (shared > 0) return b.slice(0, shared) + keyBetween(a === null ? null : a.slice(shared) || null, b.slice(shared));
  }

  const low = a ? DIGITS.indexOf(a[0]) : 0;
  const high = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;

  if (high - low > 1) return DIGITS[Math.round(0.5 * (low + high))];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  // The first digits are neighbours, so borrow a's and recurse into the tail.
  return DIGITS[low] + keyBetween(a === null ? null : a.slice(1) || null, null);
}

/** `count` keys in ascending order, all strictly between `a` and `b`. */
export function keysBetween(a: string | null, b: string | null, count: number): string[] {
  const out: string[] = [];
  let left = a;
  for (let i = 0; i < count; i++) {
    const key = keyBetween(left, b);
    out.push(key);
    left = key;
  }
  return out;
}

export interface Char {
  /** `${site}:${counter}`, unique for the life of the document. */
  id: string;
  pos: string;
  ch: string;
}

export type Op = { t: "i"; id: string; pos: string; ch: string } | { t: "d"; id: string };

export interface Edit {
  index: number;
  removed: number;
  inserted: string;
}

/** The smallest single change that turns `before` into `after`. */
export function diffText(before: string, after: string): Edit | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return {
    index: prefix,
    removed: before.length - prefix - suffix,
    inserted: after.slice(prefix, after.length - suffix),
  };
}

function compare(a: Char, b: Char) {
  if (a.pos !== b.pos) return a.pos < b.pos ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class Doc {
  readonly site: string;
  private counter = 0;
  /** Live characters, always sorted by (pos, id). */
  private chars: Char[] = [];
  private deleted = new Set<string>();
  private log: Op[] = [];
  private applied = new Set<string>();

  constructor(site: string) {
    this.site = site;
  }

  text(): string {
    let out = "";
    for (const c of this.chars) out += c.ch;
    return out;
  }

  get length() {
    return this.chars.length;
  }

  /** The complete history, for handing a newly joined peer the current state. */
  ops(): Op[] {
    return this.log.slice();
  }

  idAt(index: number): string | null {
    return this.chars[index]?.id ?? null;
  }

  indexOfId(id: string): number {
    // ponytail: linear scan. A position index would pay off past a few thousand
    // characters; a shared note never gets there.
    return this.chars.findIndex((c) => c.id === id);
  }

  /** Applies a remote or replayed op. Returns false if it was already known. */
  apply(op: Op): boolean {
    if (op.t === "d") {
      if (this.deleted.has(op.id)) return false;
      this.deleted.add(op.id);
      this.log.push(op);
      const index = this.indexOfId(op.id);
      if (index >= 0) this.chars.splice(index, 1);
      return true;
    }

    if (this.applied.has(op.id)) return false;
    this.applied.add(op.id);
    this.log.push(op);
    // A delete can arrive before the insert it refers to.
    if (this.deleted.has(op.id)) return true;

    const char: Char = { id: op.id, pos: op.pos, ch: op.ch };
    let lo = 0;
    let hi = this.chars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(this.chars[mid], char) < 0) lo = mid + 1;
      else hi = mid;
    }
    this.chars.splice(lo, 0, char);

    // Keep this site's counter ahead of anything it has seen from itself.
    const [site, counter] = op.id.split(":");
    if (site === this.site) this.counter = Math.max(this.counter, Number(counter) + 1);
    return true;
  }

  applyAll(ops: Op[]): boolean {
    let changed = false;
    for (const op of ops) changed = this.apply(op) || changed;
    return changed;
  }

  insertAt(index: number, text: string): Op[] {
    if (!text) return [];
    const at = Math.max(0, Math.min(index, this.chars.length));
    const left = at > 0 ? this.chars[at - 1].pos : null;
    const right = at < this.chars.length ? this.chars[at].pos : null;
    const positions = keysBetween(left, right, text.length);
    // Split by UTF-16 unit so indices line up with what a textarea reports.
    const ops: Op[] = text.split("").map((ch, i) => ({
      t: "i" as const,
      id: `${this.site}:${this.counter + i}`,
      pos: positions[i],
      ch,
    }));
    this.applyAll(ops);
    return ops;
  }

  deleteAt(index: number, count: number): Op[] {
    const ops: Op[] = [];
    for (let i = 0; i < count; i++) {
      const id = this.idAt(index);
      if (!id) break;
      const op: Op = { t: "d", id };
      this.apply(op);
      ops.push(op);
    }
    return ops;
  }

  /** Turns one textarea change into ops. Order matters: delete, then insert. */
  edit(before: string, after: string): Op[] {
    const change = diffText(before, after);
    if (!change) return [];
    const removed = this.deleteAt(change.index, change.removed);
    const inserted = this.insertAt(change.index, change.inserted);
    return [...removed, ...inserted];
  }
}

/**
 * ponytail: concurrent inserts at the same spot can interleave character by
 * character, which fractional indexing does not prevent. Both documents still
 * converge on the same text. Move to an RGA with per-insert origins if two
 * people typing the same word at the same instant ever becomes a real
 * complaint rather than a demo.
 */
