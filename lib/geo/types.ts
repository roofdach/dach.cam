/** A spot a round takes place at: one Google Street View panorama. */
export interface Place {
  /** Where the panorama really is. */
  lat: number;
  lng: number;
  /** Google's id for the panorama. */
  pano: string;
  /** Which way the camera faces when the round starts, in degrees. */
  heading: number;
  /** ISO 3166-1 alpha-2 code of the country it is in. */
  country: string;
  /** When Google took it, as "YYYY-MM", if Google says. */
  date?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}
