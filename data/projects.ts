export interface Project {
  title: string;
  /** One line. It follows the title, so it doesn't need to repeat it. */
  description: string;
  /** Where the title goes: a live site, a repository, anything. */
  href: string;
}

export const projects: Project[] = [
  {
    title: "palette",
    description: "one colour in, an eleven-step tailwind scale out.",
    href: "https://github.com/roofdach/palette",
  },
  {
    title: "pulse",
    description: "a dashboard for the numbers behind a codebase.",
    href: "https://github.com/roofdach/pulse",
  },
  {
    title: "together",
    description: "a shared document anyone with the link can edit.",
    href: "https://github.com/roofdach/together",
  },
  {
    title: "snip",
    description: "the conversions i kept googling, in one quiet place.",
    href: "https://github.com/roofdach/snip",
  },
  {
    title: "field",
    description: "a grid of glyphs standing in for pixels.",
    href: "https://github.com/roofdach/field",
  },
];
