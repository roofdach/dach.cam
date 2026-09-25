"use client";

import { siteConfig } from "@/config/site";
import { describePresence, FALLBACK_PRESENCE } from "@/lib/lanyard/presence";
import { useLanyard } from "@/lib/lanyard/use-lanyard";

/**
 * The last sentence of the introduction. Reads as prose, but the phrase after
 * "right now i'm" is generated from live Discord presence. Nothing here should
 * ever look like a status widget.
 */
export function DynamicPresence() {
  const { data, connection } = useLanyard(siteConfig.discordUserId);

  // Hidden until there is an answer, so the fallback never flashes first.
  const presence = data ? describePresence(data) : connection === "failed" ? FALLBACK_PRESENCE : null;
  const shown = presence ?? FALLBACK_PRESENCE;

  return (
    <p
      aria-live="polite"
      aria-atomic="true"
      className={`transition-opacity duration-700 ${presence ? "opacity-100" : "opacity-0"}`}
    >
      right now i&rsquo;m{" "}
      <span key={shown.key} className="animate-fade-in">
        {shown.phrase}
      </span>
      .
    </p>
  );
}
