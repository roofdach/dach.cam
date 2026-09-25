/**
 * Everything that talks to Google. Two of its APIs are used, both free
 * without limits: the Maps Embed API shows the panorama in an iframe, and
 * the Street View metadata endpoint says whether a spot has a panorama
 * without loading any imagery. They use different keys: the page's can only
 * embed, and the one that can look things up stays on the server (see
 * lib/geo/server/lookup.ts).
 */

import type { Place } from "./types.ts";

/** The page's key: the Maps Embed API only, restricted to this site's domains. */
export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export function embedUrl(key: string, place: Pick<Place, "pano" | "heading">): string {
  const params = new URLSearchParams({
    key,
    pano: place.pano,
    heading: String(Math.round(place.heading)),
    pitch: "0",
    fov: "90",
  });
  return `https://www.google.com/maps/embed/v1/streetview?${params}`;
}

/** The same panorama on Google Maps, for looking around after the round. */
export function mapsUrl(place: Pick<Place, "pano" | "heading" | "lat" | "lng">): string {
  const params = new URLSearchParams({
    api: "1",
    map_action: "pano",
    pano: place.pano,
    viewpoint: `${place.lat},${place.lng}`,
    heading: String(Math.round(place.heading)),
  });
  return `https://www.google.com/maps/@?${params}`;
}

export function metadataUrl(
  key: string,
  lat: number,
  lng: number,
  radiusMetres: number,
  base = "https://maps.googleapis.com/maps/api/streetview/metadata",
): string {
  const params = new URLSearchParams({
    location: `${lat.toFixed(6)},${lng.toFixed(6)}`,
    radius: String(Math.max(1, Math.round(radiusMetres))),
    source: "outdoor",
    key,
  });
  return `${base}?${params}`;
}

export type Metadata =
  | { kind: "found"; pano: string; lat: number; lng: number; date?: string }
  /** Nothing there, or only somebody's own photo sphere. */
  | { kind: "empty" }
  /** Worth asking again in a moment. */
  | { kind: "retry"; reason: string }
  /** The key is wrong or not allowed here; asking again won't help. */
  | { kind: "denied"; reason: string };

/** Panoramas Google's own cars and backpacks took have 22-character ids; uploads have longer ones. */
const OFFICIAL_PANO = /^[\w-]{22}$/;

export function readMetadata(body: unknown): Metadata {
  if (!body || typeof body !== "object") return { kind: "retry", reason: "unreadable reply from Google" };
  const { status, pano_id, location, copyright, date, error_message } = body as Record<string, unknown>;
  switch (status) {
    case "OK": {
      const lat = (location as { lat?: unknown } | undefined)?.lat;
      const lng = (location as { lng?: unknown } | undefined)?.lng;
      if (typeof pano_id !== "string" || typeof lat !== "number" || typeof lng !== "number") return { kind: "empty" };
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { kind: "empty" };
      if (!OFFICIAL_PANO.test(pano_id) || typeof copyright !== "string" || !/google/i.test(copyright)) {
        return { kind: "empty" };
      }
      return { kind: "found", pano: pano_id, lat, lng, date: typeof date === "string" && /^\d{4}-\d{2}$/.test(date) ? date : undefined };
    }
    case "ZERO_RESULTS":
    case "NOT_FOUND":
    case "INVALID_REQUEST":
      return { kind: "empty" };
    case "REQUEST_DENIED":
      return { kind: "denied", reason: typeof error_message === "string" ? error_message : "Google refused the API key." };
    default:
      return { kind: "retry", reason: typeof status === "string" ? status : "unexpected reply from Google" };
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2019-06" becomes "jun 2019". */
export function formatCaptureDate(date: string | undefined): string | null {
  const match = date && /^(\d{4})-(\d{2})$/.exec(date);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : null;
}
