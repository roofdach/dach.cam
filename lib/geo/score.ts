/** The most a round is worth. */
export const MAX_POINTS = 5000;

/**
 * GeoGuessr's curve: full marks on the spot, falling off exponentially with
 * distance, faster on smaller maps. A tenth of the map away is worth about
 * 1,840 points; half the map, about 34.
 */
export function pointsFor(km: number, scaleKm: number): number {
  if (!Number.isFinite(km) || km < 0 || !(scaleKm > 0)) return 0;
  return Math.round(MAX_POINTS * Math.exp((-10 * km) / scaleKm));
}

/** "40 m", "3.2 km", "1,284 km". */
export function formatDistance(km: number): string {
  const metres = Math.round(km * 1000);
  if (metres < 1000) return `${metres} m`;
  const tenths = Math.round(km * 10) / 10;
  if (tenths < 10) return `${tenths.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/** "12,345". */
export function formatPoints(points: number): string {
  return Math.round(points).toLocaleString("en-US");
}
