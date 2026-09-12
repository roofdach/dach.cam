export type PreviewKind = "analytics" | "collab" | "utility" | "field" | "palette";

export interface Project {
  slug: string;
  title: string;
  year: string;
  description: string;
  note?: string;
  /** Where the working version lives. */
  href: string;
  /** Where the source lives. */
  repo: string;
  stack: string[];
  preview: PreviewKind;
  featured?: boolean;
}

export const projects: Project[] = [
  {
    slug: "palette",
    href: "/work/palette",
    repo: "https://github.com/roofdach/palette",
    title: "palette",
    year: "2026",
    description:
      "one colour in, an eleven-step tailwind scale out. kept inside srgb and checked for contrast.",
    note: "type a colour, or click a step to build from that one.",
    stack: ["typescript", "oklab", "react"],
    preview: "palette",
    featured: true,
  },
  {
    slug: "pulse",
    href: "/work/pulse",
    repo: "https://github.com/roofdach/pulse",
    title: "pulse",
    year: "2026",
    description:
      "a dashboard for the numbers behind a codebase. commits, review latency, where the time actually goes.",
    note: "try changing the range, hovering the chart, or filtering by language.",
    stack: ["typescript", "react", "svg", "motion"],
    preview: "analytics",
  },
  {
    slug: "together",
    href: "/work/together",
    repo: "https://github.com/roofdach/together",
    title: "together",
    year: "2025",
    description:
      "a shared document. whoever else has the link is editing the same copy you are.",
    note: "the top block is yours. type in it.",
    stack: ["typescript", "react", "state machines", "motion"],
    preview: "collab",
  },
  {
    slug: "snip",
    href: "/work/snip",
    repo: "https://github.com/roofdach/snip",
    title: "snip",
    year: "2025",
    description:
      "the conversions i kept googling, in one quiet place. nothing ever leaves the tab.",
    note: "fully functional. paste something in.",
    stack: ["typescript", "react", "web apis"],
    preview: "utility",
  },
  {
    slug: "field",
    href: "/work/field",
    repo: "https://github.com/roofdach/field",
    title: "field",
    year: "2026",
    description:
      "a grid of glyphs standing in for pixels. move over it, make it spell something, take it away as a component.",
    note: "move over it. click to drop a ripple.",
    stack: ["typescript", "canvas", "requestAnimationFrame"],
    preview: "field",
  },
];
