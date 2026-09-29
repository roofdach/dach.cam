import type { Metadata } from "next";
import { Sus } from "@/components/sus/Sus";
import { multiplayerReady } from "@/lib/rooms/store";

const title = "sus";
const description = "an among us. do your tasks and find the impostor before they get you all; or be the impostor. join with a four-letter code.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og"] },
};

export default function SusPage() {
  return <Sus multiplayer={multiplayerReady()} />;
}
