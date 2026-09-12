import type { Metadata } from "next";
import { Frame } from "@/components/apps/Frame";
import { PulseClient } from "@/components/apps/PulseClient";

export const metadata: Metadata = {
  title: "pulse",
  description: "a dashboard for the boring-but-important numbers behind a codebase.",
};

export default function PulsePage() {
  return (
    <Frame
      slug="pulse"
      wide
      tagline="commits, review latency and where the time actually goes. point it at a real repository if you like."
      notes={
        <p>
          it opens on generated data. type <code className="font-mono text-[12px]">owner/repo</code> and it reads a real
          repository from github&rsquo;s public api instead — no token, no server in between.
        </p>
      }
    >
      <PulseClient />
    </Frame>
  );
}
