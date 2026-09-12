import type { Metadata } from "next";
import { Frame } from "@/components/apps/Frame";
import { Palette } from "@/components/apps/Palette";

export const metadata: Metadata = {
  title: "palette",
  description: "one colour in, an eleven-step tailwind v4 scale out, kept inside srgb and checked for contrast.",
};

export default function PalettePage() {
  return (
    <Frame
      slug="palette"
      tagline="one colour in, an eleven-step scale out, kept inside srgb and checked for contrast."
      notes={
        <p>
          spaced the way tailwind v4 spaces its own palettes. when a hue can&rsquo;t be that colourful at that
          lightness the chroma comes down, rather than the channels being clipped.
        </p>
      }
    >
      <Palette />
    </Frame>
  );
}
