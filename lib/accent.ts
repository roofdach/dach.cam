/**
 * The site's accent colour, as chosen in `palette`. Two values are stored, one
 * for each colour scheme, because a colour that reads well on paper is rarely
 * the same one that reads well in the dark.
 */

export const ACCENT_KEY = "accent";

export interface Accent {
  light: string;
  dark: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isAccent(value: unknown): value is Accent {
  if (!value || typeof value !== "object") return false;
  const accent = value as Record<string, unknown>;
  return typeof accent.light === "string" && HEX.test(accent.light) && typeof accent.dark === "string" && HEX.test(accent.dark);
}

/**
 * A one-value store so React can read the accent without a hydration mismatch:
 * the server has no answer, the client has one, and `useSyncExternalStore`
 * exists precisely for that gap.
 */
let current: Accent | null | undefined;
const listeners = new Set<() => void>();

export function subscribeAccent(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cached, because a snapshot is read on every render. */
export function currentAccent(): Accent | null {
  if (current === undefined) current = readAccent();
  return current;
}

export const accentApplied = () => currentAccent() !== null;
export const noAccentApplied = () => false;

/** Writes the two variables the stylesheet reads, or clears them. */
export function applyAccent(accent: Accent | null) {
  const root = document.documentElement.style;
  if (!accent) {
    root.removeProperty("--accent-light");
    root.removeProperty("--accent-dark");
  } else {
    root.setProperty("--accent-light", accent.light);
    root.setProperty("--accent-dark", accent.dark);
  }
  try {
    if (accent) localStorage.setItem(ACCENT_KEY, JSON.stringify(accent));
    else localStorage.removeItem(ACCENT_KEY);
  } catch {
    // Private browsing, or storage turned off. The colour still applies here.
  }
  current = accent;
  listeners.forEach((listener) => listener());
}

export function readAccent(): Accent | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(ACCENT_KEY) ?? "null");
    return isAccent(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Runs while the html is still being parsed, so a chosen accent is already in
 * place before anything is painted. Kept to one line and defensive, because a
 * throw here would stop the rest of the document.
 */
export const ACCENT_SCRIPT =
  `try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(ACCENT_KEY)})||"null"),h=/^#[0-9a-f]{6}$/i;` +
  `if(a&&h.test(a.light)&&h.test(a.dark)){var s=document.documentElement.style;` +
  `s.setProperty("--accent-light",a.light);s.setProperty("--accent-dark",a.dark)}}catch(e){}`;
