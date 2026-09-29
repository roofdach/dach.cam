import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Snake } from "@/components/snake/Snake";
import { CODE_PATTERN } from "@/lib/rooms/codes";
import { multiplayerReady } from "@/lib/rooms/store";

export async function generateMetadata({ params }: PageProps<"/snake/[code]">): Promise<Metadata> {
  const code = (await params).code.toUpperCase();
  const title = `snake · room ${code}`;
  const description = "you've been challenged to a snake race: the same board, at the same time, most apples wins.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og"] },
  };
}

/** A race's own address, for a link or a refresh. */
export default async function RoomPage({ params }: PageProps<"/snake/[code]">) {
  const { code } = await params;
  const upper = code.toUpperCase();
  if (!CODE_PATTERN.test(upper)) notFound();
  if (upper !== code) redirect(`/snake/${upper}`);
  return <Snake room={upper} multiplayer={multiplayerReady()} />;
}
