import type { Metadata } from "next";
import { Snake } from "@/components/snake/Snake";
import { multiplayerReady } from "@/lib/rooms/store";

const title = "snake";
const description = "a snake. eat the apples, grow, go faster, get on the high scores, or race a friend on the same board.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og"] },
};

export default function SnakePage() {
  return <Snake multiplayer={multiplayerReady()} />;
}
