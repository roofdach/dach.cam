import type { Metadata } from "next";
import { Frame } from "@/components/apps/Frame";
import { TogetherClient } from "@/components/apps/TogetherClient";

export const metadata: Metadata = {
  title: "together",
  description: "a shared document with live cursors and a real sequence crdt. send someone the link and you are both in it.",
};

export default function TogetherPage() {
  return (
    <Frame
      slug="together"
      tagline="one document, everyone who has the link. send it to someone and watch the two copies agree."
      notes={
        <p>
          every character carries a key that sorts it between its neighbours, so two people typing in the same place
          both keep their text. the server holds the room&rsquo;s log, which is why the note outlives the last tab.
          add <code className="font-mono text-[12px]">?room=anything</code> for one of your own.
        </p>
      }
    >
      <TogetherClient />
    </Frame>
  );
}
