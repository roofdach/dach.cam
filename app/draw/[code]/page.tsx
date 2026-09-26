import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Draw } from "@/components/draw/Draw";
import { CODE_PATTERN } from "@/lib/rooms/codes";
import { multiplayerReady } from "@/lib/rooms/store";

export async function generateMetadata({ params }: PageProps<"/draw/[code]">): Promise<Metadata> {
  const code = (await params).code.toUpperCase();
  const title = `draw · room ${code}`;
  const description = "you've been invited to a game of draw: take turns drawing a word while everyone else guesses it.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og"] },
  };
}

/** A room's own address, for a link or a refresh. */
export default async function RoomPage({ params }: PageProps<"/draw/[code]">) {
  const { code } = await params;
  const upper = code.toUpperCase();
  if (!CODE_PATTERN.test(upper)) notFound();
  if (upper !== code) redirect(`/draw/${upper}`);
  return <Draw room={upper} multiplayer={multiplayerReady()} />;
}
