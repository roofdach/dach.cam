"use client";

import dynamic from "next/dynamic";
import type { PreviewKind } from "@/data/projects";

function Skeleton() {
  return <div className="h-full min-h-[18rem] w-full animate-pulse bg-paper-2" aria-hidden />;
}

const registry = {
  analytics: dynamic(() => import("./previews/AnalyticsPreview").then((m) => m.AnalyticsPreview), { loading: Skeleton }),
  collab: dynamic(() => import("./previews/CollabPreview").then((m) => m.CollabPreview), { loading: Skeleton }),
  utility: dynamic(() => import("./previews/UtilityPreview").then((m) => m.UtilityPreview), { loading: Skeleton }),
  field: dynamic(() => import("./previews/FieldPreview").then((m) => m.FieldPreview), { loading: Skeleton }),
  palette: dynamic(() => import("./previews/PalettePreview").then((m) => m.PalettePreview), { loading: Skeleton }),
} satisfies Record<PreviewKind, unknown>;

export function ProjectPreview({ kind, title }: { kind: PreviewKind; title: string }) {
  const Preview = registry[kind];
  return (
    <div
      className="@container relative h-full overflow-hidden rounded-xl border border-line bg-paper-2 shadow-[0_1px_0_0_var(--line)] transition-[border-color,box-shadow] duration-500 group-hover:border-faint"
      role="group"
      aria-label={`${title} preview`}
    >
      <Preview />
    </div>
  );
}
