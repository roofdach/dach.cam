import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Geo } from "@/components/geo/Geo";
import { CODE_PATTERN } from "@/lib/rooms/codes";
import { multiplayerReady } from "@/lib/rooms/store";
import { streetViewReady } from "@/lib/geo/server/lookup";

export async function generateMetadata({ params }: PageProps<"/geo/[code]">): Promise<Metadata> {
  const code = (await params).code.toUpperCase();
  const title = `geo · room ${code}`;
  const description = "you've been invited to a game of geo: guess where in the world you are from street view.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og"] },
  };
}

/** A room's own address, so a link is all it takes to join. */
export default async function RoomPage({ params }: PageProps<"/geo/[code]">) {
  const { code } = await params;
  const upper = code.toUpperCase();
  if (!CODE_PATTERN.test(upper)) notFound();
  if (upper !== code) redirect(`/geo/${upper}`);
  return <Geo room={upper} multiplayer={multiplayerReady()} streetView={streetViewReady()} />;
}
