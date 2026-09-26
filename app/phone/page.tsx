import type { Metadata } from "next";
import { Phone } from "@/components/phone/Phone";
import { multiplayerReady } from "@/lib/rooms/store";

const title = "phone";
const description = "a gartic phone. write something, draw what someone else wrote, guess what someone else drew, then watch it all go wrong.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og"] },
};

export default function PhonePage() {
  return <Phone multiplayer={multiplayerReady()} />;
}
