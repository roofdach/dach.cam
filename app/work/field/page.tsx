import type { Metadata } from "next";
import { Field } from "@/components/apps/Field";
import { Frame } from "@/components/apps/Frame";

export const metadata: Metadata = {
  title: "field",
  description: "a typographic field that treats characters as pixels.",
};

export default function FieldPage() {
  return (
    <Frame
      slug="field"
      wide
      tagline="a grid of glyphs standing in for pixels. move over it, click it, or make it spell something."
      notes={
        <p>
          one number per cell: a wave, your pointer, and any ripples still travelling. a stencil is text added to that
          number, which is why letters bend when a ripple passes through them.
        </p>
      }
    >
      <Field />
    </Frame>
  );
}
