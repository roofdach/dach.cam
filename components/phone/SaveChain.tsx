"use client";

import { useState } from "react";
import { chainImage, imageName } from "@/components/game/image-export";
import { SaveImage } from "@/components/game/SaveImage";
import type { PhoneClient, View } from "./room-client";

/** Only offer whole chains the host has already shown, including earlier ones. */
export function SaveChain({ view, client }: { view: View; client: PhoneClient }) {
  const [picked, setPicked] = useState<number | null>(null);
  const game = view.game!;
  const album = game.album!;
  const available = album.flatMap((chain, index) => {
    const shown = album.slice(0, index + 1).reduce((count, item) => count + item.entries.length, 0);
    return chain.entries.length > 0 && shown <= game.shown ? [index] : [];
  });
  const selected = available.find((index) => index === picked) ?? available.at(-1);
  if (selected === undefined) return null;
  const owner = (index: number) => view.players.find((player) => player.id === album[index].owner)?.name ?? "someone";
  const makeImage = async () => {
    const entries = await client.chainEntries(game.index, selected);
    const byStep = new Map(entries.map((entry) => [entry.step, entry]));
    const rows = album[selected].entries.map((step) => {
      const entry = byStep.get(step.step);
      if (!entry) throw new Error("that chain hasn't finished loading; try again");
      const player = view.players.find((player) => player.id === step.p);
      return {
        author: player?.name ?? "someone",
        color: player?.color ?? "#6e6b63",
        work: "text" in entry ? { text: entry.text } : { ops: entry.ops },
      };
    });
    return chainImage(`${owner(selected)}'s chain`, rows);
  };
  return (
    <section aria-label="Save a finished chain" className="mt-8 flex flex-wrap items-start justify-center gap-3 border-t border-faint/50 pt-5">
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        <span>chain to save</span>
        <select value={selected} onChange={(event) => setPicked(Number(event.target.value))} className="min-h-9 max-w-full rounded-lg border border-faint/80 bg-paper px-3 text-[14px] text-ink">
          {available.map((index) => <option key={index} value={index}>{owner(index)}&rsquo;s chain</option>)}
        </select>
      </label>
      <div className="pt-[22px]">
        <SaveImage label="save chain" filename={`phone-${view.code}-${game.index}-${selected + 1}-${imageName(owner(selected))}`} makeImage={makeImage} />
      </div>
      <p className="basis-full text-center text-[12.5px] text-muted">a PNG with every drawing, sentence and name. save it before starting another game.</p>
    </section>
  );
}
