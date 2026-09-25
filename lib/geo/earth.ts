/** Mean radius of the earth in km. */
export const EARTH_RADIUS_KM = 6371.0088;

/** GeoGuessr's size of the world map, which sets how fast points fall off with distance. */
export const WORLD_SCALE_KM = 14916.862;

const RADIANS = Math.PI / 180;

/** Longitude folded into [-180, 180). */
export function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * RADIANS;
  const dLng = (lng2 - lng1) * RADIANS;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RADIANS) * Math.cos(lat2 * RADIANS) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/** Where you end up walking `km` from a point on a compass bearing. */
export function destination(lat: number, lng: number, bearing: number, km: number): [lat: number, lng: number] {
  const angle = km / EARTH_RADIUS_KM;
  const φ1 = lat * RADIANS;
  const θ = bearing * RADIANS;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(angle) + Math.cos(φ1) * Math.sin(angle) * Math.cos(θ));
  const λ2 =
    lng * RADIANS +
    Math.atan2(Math.sin(θ) * Math.sin(angle) * Math.cos(φ1), Math.cos(angle) - Math.sin(φ1) * Math.sin(φ2));
  return [φ2 / RADIANS, wrapLongitude(λ2 / RADIANS)];
}
