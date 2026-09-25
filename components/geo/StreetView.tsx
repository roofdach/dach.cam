"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { GOOGLE_MAPS_KEY, embedUrl } from "@/lib/geo/streetview";
import styles from "./geo.module.css";

/**
 * Google's own Street View, through the free Maps Embed API. It streams
 * small tiles and is built to run on modest graphics, which suits school
 * laptops. The frame can't be told to hide the address Google prints in its
 * top corner, so the frame is taller than the screen and that strip hangs off
 * the top, out of sight. Google's logo and terms along the bottom stay put.
 */
const CROP_PX = 120;

export function StreetView({
  pano,
  heading,
  visible,
  reset = 0,
}: {
  pano: string;
  heading: number;
  /** Hidden frames still load, so the next round can be ready before it starts. */
  visible: boolean;
  /** Bump to send the view back to where the round started. */
  reset?: number;
}) {
  const src = embedUrl(GOOGLE_MAPS_KEY, { pano, heading });
  const [loaded, setLoaded] = useState<string | null>(null);
  const [slow, setSlow] = useState<string | null>(null);
  const token = `${src}#${reset}`;

  // If Google's frame never turns up, say why that might be rather than spin forever.
  useEffect(() => {
    if (loaded === token) return;
    const timer = setTimeout(() => setSlow(token), 12_000);
    return () => clearTimeout(timer);
  }, [loaded, token]);

  return (
    <div
      aria-hidden={!visible}
      className="absolute inset-0 overflow-hidden bg-[#2b2a27]"
      style={{ visibility: visible ? "visible" : "hidden", pointerEvents: visible ? "auto" : "none" }}
    >
      <iframe
        key={reset}
        title="Street View"
        src={src}
        tabIndex={visible ? 0 : -1}
        allow="fullscreen; accelerometer; gyroscope"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setLoaded(token)}
        className={styles.street}
        style={{ "--crop": `${CROP_PX}px` } as CSSProperties}
      />
      {loaded !== token && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#2b2a27]">
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <div className={styles.spinner} role="status" aria-label="Loading Street View" />
            {slow === token && (
              <p className="max-w-[22rem] text-[13px] text-[#d8d4ca]">
                street view is taking a while. if it never shows up, this network may be blocking google maps.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
