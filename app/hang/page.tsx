import type { Metadata } from "next";
import { Hang } from "@/components/hang/Hang";
import { multiplayerReady } from "@/lib/rooms/store";

const title = "hang";
const description = "a hangman. race your friends to the same word, or take turns picking one to hang the rest. join with a four-letter code.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og"] },
};

export default function HangPage() {
  return <Hang multiplayer={multiplayerReady()} />;
}
