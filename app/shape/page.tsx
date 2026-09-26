import type { Metadata } from "next";
import { Shape } from "@/components/shape/Shape";
import { multiplayerReady } from "@/lib/rooms/store";

const title = "shape";
const description = "a worldle. guess the country from its outline: a daily, practice, a speed round, a quiz, or a race with friends.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og"] },
};

export default function ShapePage() {
  return <Shape multiplayer={multiplayerReady()} />;
}
