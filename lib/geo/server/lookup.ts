/**
 * Asks Google whether spots have Street View, on the browser's behalf.
 *
 * This runs on the server because the API that answers (the Street View
 * Static API's metadata endpoint, free) also sells Street View images, and a
 * key for it can't safely sit in a web page: anyone could lift it and run up
 * a bill. The key the page carries only does the Maps Embed API, which is
 * free however much it's used. This one stays in an environment variable and
 * only ever asks for metadata.
 */

import { GOOGLE_MAPS_KEY, metadataUrl, readMetadata, type Metadata } from "../streetview.ts";

/** A spot to ask about: latitude, longitude and search radius in metres. */
export type Probe = [lat: number, lng: number, radius: number];

/** At most this many spots per request; the finder asks in batches of eight. */
export const MAX_PROBES = 8;

const GOOGLE = "https://maps.googleapis.com/maps/api/streetview/metadata";
const TIMEOUT_MS = 6000;

export function isProbe(value: unknown): value is Probe {
  if (!Array.isArray(value) || value.length !== 3) return false;
  const [lat, lng, radius] = value;
  return (
    typeof lat === "number" &&
    Math.abs(lat) <= 90 &&
    typeof lng === "number" &&
    Math.abs(lng) <= 180 &&
    typeof radius === "number" &&
    radius >= 1 &&
    radius <= 10_000
  );
}

async function one([lat, lng, radius]: Probe, key: string, base: string, fetcher: typeof fetch): Promise<Metadata> {
  try {
    const response = await fetcher(metadataUrl(key, lat, lng, radius, base), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return { kind: "retry", reason: `Google replied ${response.status}` };
    return readMetadata(await response.json());
  } catch {
    return { kind: "retry", reason: "no reply from Google" };
  }
}

/** Every probe's answer, in order. Failures come back as "retry" for the browser to try again. */
export function lookUp(
  probes: Probe[],
  key: string,
  { base = GOOGLE, fetcher = fetch }: { base?: string; fetcher?: typeof fetch } = {},
): Promise<Metadata[]> {
  return Promise.all(probes.map((probe) => one(probe, key, base, fetcher)));
}

/**
 * Whether this deployment has both keys: the page's, built into the page for
 * showing Street View, and the server's, for finding it.
 */
export function streetViewReady(env: Record<string, string | undefined> = process.env): boolean {
  return GOOGLE_MAPS_KEY !== "" && Boolean(env.GOOGLE_MAPS_SERVER_KEY);
}
