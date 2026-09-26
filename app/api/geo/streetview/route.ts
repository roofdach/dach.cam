import { RoomError, failure, fresh, readBody } from "@/lib/rooms/http";
import { MAX_PROBES, isProbe, lookUp } from "@/lib/geo/server/lookup";

/**
 * Whether a handful of spots have Street View, answered with the server's
 * key so it never reaches a web page. Only ever asks Google for metadata,
 * which is free.
 */
export async function POST(request: Request) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return fresh({ error: "street view lookups aren't set up on this site yet" }, 503);
  try {
    const body = await readBody(request);
    const probes = (body as { probes?: unknown } | null)?.probes;
    if (!Array.isArray(probes) || probes.length === 0 || probes.length > MAX_PROBES || !probes.every(isProbe)) {
      throw new RoomError(400, "those spots don't look right");
    }
    // Only for tests, which stand in for Google locally.
    const base = process.env.GEO_METADATA_URL || undefined;
    return fresh({ results: await lookUp(probes, key, { base }) });
  } catch (error) {
    return failure(error);
  }
}
