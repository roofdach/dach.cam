import { lastStroke, nextStroke, type Op } from "./ink.ts";

export interface HistoryState {
  undo: boolean;
  redo: boolean;
}

/** Keeps undo/redo local while recording only operations every room already understands. */
export class InkHistory {
  ops: Op[] = [];
  private next = 0;
  private undone: Op[][] = [];

  restore(ops: readonly Op[]) {
    this.ops = [...ops];
    this.next = nextStroke(ops);
    this.undone = [];
  }

  /** A fresh drawing action ends the redo branch. */
  start() {
    this.undone = [];
    return this.next++;
  }

  append(op: Op) {
    this.ops.push(op);
  }

  get state(): HistoryState {
    return { undo: lastStroke(this.ops) !== null, redo: this.undone.length > 0 };
  }

  undo(): Op | null {
    const id = lastStroke(this.ops);
    if (id === null) return null;
    // A long stroke has several line operations sharing one id.
    this.undone.push(this.ops.filter((op) => op[0] !== "u" && op[1] === id));
    const op: Op = ["u", id];
    this.ops.push(op);
    return op;
  }

  redo(): Op[] {
    const action = this.undone.pop();
    if (!action) return [];
    // Undo records are permanent. Reapply with a fresh id so replay and export
    // can still use the existing append-only drawing format.
    const id = this.next++;
    const restored = action.map((op) => {
      const copy = [...op] as Op;
      copy[1] = id;
      return copy;
    });
    this.ops.push(...restored);
    return restored;
  }
}
