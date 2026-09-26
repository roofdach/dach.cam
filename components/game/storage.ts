/**
 * localStorage that never throws: private windows, full disks and blocked
 * storage all just mean nothing is remembered.
 */

export function load<T>(key: string, isValid: (value: unknown) => value is T): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function forget(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

export const KEYS = {
  /** Your name, shared by every game with rooms. */
  name: "games:name",
  menu: "geo:menu",
  solo: "geo:solo",
  daily: "geo:daily",
  room: (code: string) => `geo:room:${code}`,
  drawRoom: (code: string) => `draw:room:${code}`,
  phoneRoom: (code: string) => `phone:room:${code}`,
  /** What you've written or drawn so far this step, in case the page reloads. */
  phoneDraft: (code: string, game: number, step: number) => `phone:draft:${code}:${game}:${step}`,
} as const;

export const isString = (value: unknown): value is string => typeof value === "string";
