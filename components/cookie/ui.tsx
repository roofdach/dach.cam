"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

/* ---------------------------------------------------------------- motion */

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(REDUCE).matches,
    () => false,
  );
}

/* ----------------------------------------------------------------- modal */

/**
 * A native dialog, opened modally so focus stays inside it and everything
 * behind it is inert. Escape calls `onCancel`, or does nothing without one.
 */
export function Modal({
  labelledBy,
  onCancel,
  className = "",
  children,
}: {
  labelledBy: string;
  onCancel?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef(onCancel);

  useEffect(() => {
    cancel.current = onCancel;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onKey = (event: Event) => {
      event.preventDefault();
      cancel.current?.();
    };
    dialog.addEventListener("cancel", onKey);
    return () => {
      dialog.removeEventListener("cancel", onKey);
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-faint/60 bg-paper p-6 text-ink shadow-2xl backdrop:bg-black/45 ${className}`}
    >
      {children}
    </dialog>
  );
}

/* ------------------------------------------------------------ segmented */

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-faint/70 p-0.5 text-[12.5px]">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="min-w-8 rounded-md px-2 py-1 text-muted transition-colors hover:text-ink aria-pressed:bg-ink aria-pressed:text-paper"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ copy */

const MILKS = [
  ["Plain milk", "#ffffff"],
  ["Chocolate milk", "#9c6b45"],
  ["Raspberry milk", "#e2809f"],
  ["Orange milk", "#f1a85e"],
  ["Caramel milk", "#d6a257"],
  ["Banana milk", "#efd97f"],
  ["Lime milk", "#b3d77a"],
  ["Blueberry milk", "#7f98d8"],
  ["Lavender milk", "#c3b0ec"],
] as const;

/** Each full glass of milk (25 achievements) is a new flavour. */
export function milkFlavour(milk: number): { name: string; color: string } {
  const [name, color] = MILKS[Math.min(MILKS.length - 1, Math.floor(milk))];
  return { name, color };
}

/** What a golden cookie calls a boost from each building. */
export const BUILDING_SPECIALS = [
  "Handiwork",
  "Bake sale",
  "Harvest festival",
  "Mother lode",
  "Overtime",
  "Interest spike",
  "Holy day",
  "Spell surge",
  "Express delivery",
  "Golden touch",
  "Open doors",
  "Time warp",
  "Chain reaction",
  "Solar flare",
  "Hot streak",
  "Deep zoom",
  "Hotfix",
  "Big bang",
  "Brain wave",
  "Self-improvement",
];

/** A multiplier the way people say it: ×7, ×3.1, ×777. */
export const times = (multiplier: number) => `×${Math.round(multiplier * 10) / 10}`;
