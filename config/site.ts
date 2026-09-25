export interface SiteConfig {
  name: string;
  age: number;
  location: string;
  /** Read by Lanyard to describe what you're doing. Never shown on the page. */
  discordUserId: string;
  /** The row of links at the bottom of the page, in order. */
  links: { label: string; href: string }[];
  /** Only a fallback, for when there is no request to read a domain from. */
  url: string;
  description: string;
}

// Everything personal lives here. The projects are in data/projects.ts.
export const siteConfig: SiteConfig = {
  name: "dach",
  age: 16,
  location: "Ireland",

  discordUserId: "504805980631072778",

  links: [
    { label: "github", href: "https://github.com/roofdach" },
    { label: "x", href: "https://x.com/dachhcc" },
    { label: "email", href: "mailto:me@dachh.cc" },
  ],

  url: "https://dach.cam",
  description:
    "a developer in ireland who mostly builds for the web. frontend, interfaces, and small experiments.",
};
