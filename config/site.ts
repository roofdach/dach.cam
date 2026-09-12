export interface SiteConfig {
  name: string;
  age: number;
  location: string;
  discordUserId: string;
  email: string;
  github: string;
  instagram: string;
  x: string;
  rss: string;
  /** Shown as plain text in the contact section, e.g. "yourhandle". */
  discordHandle: string;
  url: string;
  description: string;
}

// Everything personal lives here. Leave a link empty ("") and it won't render.
export const siteConfig: SiteConfig = {
  name: "dach",
  age: 16,
  location: "Ireland",

  discordUserId: "504805980631072778",

  email: "me@dachh.cc",
  github: "https://github.com/roofdach",
  instagram: '',
  rss: '',
  x: "https://x.com/dachhcc",
  discordHandle: "dachh.cc",

  url: "https://dach.cam",
  description:
    "a developer in ireland who mostly builds for the web. frontend, interfaces, and small experiments.",
};
