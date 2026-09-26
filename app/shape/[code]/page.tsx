import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Shape } from "@/components/shape/Shape";
import { CODE_PATTERN } from "@/lib/rooms/codes";
import { multiplayerReady } from "@/lib/rooms/store";

export async function generateMetadata({ params }: PageProps<"/shape/[code]">): Promise<Metadata> {
  const code = (await params).code.toUpperCase();
  const title = `shape · room ${code}`;
  const description = "you've been invited to a shape race: everyone gets the same country outline, fastest right answer wins.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og"] },
  };
}

/** A race's own address, for a link or a refresh. */
export default async function RoomPage({ params }: PageProps<"/shape/[code]">) {
  const { code } = await params;
  const upper = code.toUpperCase();
  if (!CODE_PATTERN.test(upper)) notFound();
  if (upper !== code) redirect(`/shape/${upper}`);
  return <Shape room={upper} multiplayer={multiplayerReady()} />;
}
