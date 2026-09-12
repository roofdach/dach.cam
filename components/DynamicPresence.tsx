"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { siteConfig } from "@/config/site";
import { describePresence, FALLBACK_PRESENCE } from "@/lib/lanyard/presence";
import { useLanyard } from "@/lib/lanyard/use-lanyard";

/**
 * The last sentence of the introduction. Reads as prose, but the phrase after
 * "right now i'm" is generated from live Discord presence. Nothing here should
 * ever look like a status widget.
 */
export function DynamicPresence({ className }: { className?: string }) {
  const { data, connection } = useLanyard(siteConfig.discordUserId);
  const reduce = useReducedMotion();

  const presence = useMemo(() => {
    if (data) return describePresence(data);
    if (connection === "failed") return FALLBACK_PRESENCE;
    return null;
  }, [data, connection]);

  const ready = presence !== null;
  const shown = presence ?? FALLBACK_PRESENCE;

  return (
    <p
      className={className}
      aria-live="polite"
      aria-atomic="true"
      style={{
        opacity: ready ? 1 : 0,
        transition: reduce ? undefined : "opacity 900ms cubic-bezier(0.25, 1, 0.5, 1)",
      }}
    >
      right now i&rsquo;m{" "}
      {reduce ? (
        <span>{shown.phrase}</span>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={shown.key}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.25, 1, 0.5, 1] }}
          >
            {shown.phrase}
          </motion.span>
        </AnimatePresence>
      )}
      .
    </p>
  );
}
