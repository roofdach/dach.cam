import type { Metadata } from "next";
import { Flap } from "@/components/flap/Flap";
import { multiplayerReady } from "@/lib/rooms/store";

const title = "flap";
const description = "a flappy bird. tap to flap through the pipes, get on the high scores, or race a friend on the same pipes.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og"] },
};

export default function FlapPage() {
  return <Flap multiplayer={multiplayerReady()} />;
}
