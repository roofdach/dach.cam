"use client";

import { useState } from "react";
import { downloadImage } from "./image-export";
import { Button, Spinner } from "./ui";

export function SaveImage({
  label,
  filename,
  makeImage,
}: {
  label: string;
  filename: string;
  makeImage: () => HTMLCanvasElement | Promise<HTMLCanvasElement>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await downloadImage(await makeImage(), filename);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "couldn't save that image; try again");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={() => void save()} disabled={busy}>
        {busy ? <><Spinner /> saving…</> : label}
      </Button>
      {error && <p role="alert" className="text-[13px] text-accent">{error}</p>}
    </div>
  );
}
