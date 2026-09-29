import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Flap } from "@/components/flap/Flap";
import { CODE_PATTERN } from "@/lib/rooms/codes";
import { multiplayerReady } from "@/lib/rooms/store";

export async function generateMetadata({ params }: PageProps<"/flap/[code]">): Promise<Metadata> {
  const code = (await params).code.toUpperCase();
  const title = `flap · room ${code}`;
  const description = "you've been challenged to a flappy bird race: the same pipes, at the same time, furthest wins.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og"] },
  };
}

/** A race's own address, for a link or a refresh. */
export default async function RoomPage({ params }: PageProps<"/flap/[code]">) {
  const { code } = await params;
  const upper = code.toUpperCase();
  if (!CODE_PATTERN.test(upper)) notFound();
  if (upper !== code) redirect(`/flap/${upper}`);
  return <Flap room={upper} multiplayer={multiplayerReady()} />;
}
