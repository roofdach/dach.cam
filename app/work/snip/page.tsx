import type { Metadata } from "next";
import { Snip } from "@/components/apps/Snip";
import { Frame } from "@/components/apps/Frame";

export const metadata: Metadata = {
  title: "snip",
  description: "json, base64, url, colour, hash, jwt, time and text conversions, done in the browser.",
};

export default function SnipPage() {
  return (
    <Frame
      slug="snip"
      tagline="the handful of conversions i kept googling, in one quiet place."
      notes={
        <p>
          everything runs in the tab you have open — nothing is uploaded and nothing is logged. the jwt tool decodes,
          it does not verify.
        </p>
      }
    >
      <Snip />
    </Frame>
  );
}
