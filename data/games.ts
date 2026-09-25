export interface Game {
  title: string;
  /** One line. It follows the title, so it doesn't need to repeat it. */
  description: string;
  /** Where the title goes: a page on this site, or anywhere else. */
  href: string;
}

export const games: Game[] = [
  {
    title: "cookie",
    description: "a cookie clicker, golden cookies and all.",
    href: "/cookie",
  },
];
