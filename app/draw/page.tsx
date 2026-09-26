import type { Metadata } from "next";
import { Draw } from "@/components/draw/Draw";
import { multiplayerReady } from "@/lib/rooms/store";

const title = "draw";
const description = "a skribbl. one of you draws a word, everyone else races to guess it. join with a four-letter code.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og"] },
};

export default function DrawPage() {
  return <Draw multiplayer={multiplayerReady()} />;
}
