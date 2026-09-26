export interface Game {
  title: string;
  /** One line. It follows the title, so it doesn't need to repeat it. */
  description: string;
  /** Where the title goes: a page on this site, or anywhere else. */
  href: string;
}

export const games: Game[] = [
  {
    title: "draw",
    description: "a skribbl. one draws, everyone else guesses; join with a four-letter code.",
    href: "/draw",
  },
  {
    title: "phone",
    description: "a gartic phone. write, draw what someone wrote, guess what someone drew, watch it go wrong.",
    href: "/phone",
  },
  {
    title: "geo",
    description: "a geoguessr. solo, a daily, or a room with friends.",
    href: "/geo",
  },
  {
    title: "cookie",
    description: "a cookie clicker, golden cookies and all.",
    href: "/cookie",
  },
];
