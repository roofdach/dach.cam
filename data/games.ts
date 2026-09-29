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
    title: "sus",
    description: "an among us. walk the ship, do your tasks, find the impostor and vote them off; or be the impostor and don't get caught.",
    href: "/sus",
  },
  {
    title: "hang",
    description: "a hangman. race friends to the same word, or take turns picking one to hang the rest.",
    href: "/hang",
  },
  {
    title: "flap",
    description: "a flappy bird. high scores, and races against a friend on the same pipes.",
    href: "/flap",
  },
  {
    title: "snake",
    description: "a snake. high scores, and races against a friend on the same board.",
    href: "/snake",
  },
  {
    title: "shape",
    description: "a worldle. name the country from its outline: daily, speed, quiz, or race friends.",
    href: "/shape",
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
