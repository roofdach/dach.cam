import type { Metadata } from "next";
import { Geo } from "@/components/geo/Geo";
import { multiplayerReady } from "@/lib/geo/server/store";
import { streetViewReady } from "@/lib/geo/server/lookup";

const title = "geo";
const description = "a geoguessr. drop into street view somewhere on earth and guess where you are: alone, in the daily, or with friends.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og"] },
};

export default function GeoPage() {
  return <Geo multiplayer={multiplayerReady()} streetView={streetViewReady()} />;
}
