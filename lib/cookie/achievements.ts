import { BUILDINGS } from "./buildings.ts";
import { formatNumber } from "./format.ts";

/** What an achievement can look at. The engine fills this in. */
export interface AchievementContext {
  /** Baked this run. */
  baked: number;
  cps: number;
  /** Made by clicking this run. */
  handmade: number;
  /** Cookie clicks this run. */
  clicks: number;
  owned: readonly number[];
  totalOwned: number;
  /** Bought this run. */
  upgrades: number;
  goldenClicks: number;
  ascensions: number;
  prestige: number;
  /** Seconds since this run started. */
  runSeconds: number;
  newsClicks: number;
  frenzy: boolean;
  clickFrenzy: boolean;
}

export type AchievementGroup = "baking" | "buildings" | "golden" | "legacy" | "other";

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  group: AchievementGroup;
  /** Checked every so often. Without one, the engine awards it when the thing happens. */
  test?: (c: AchievementContext) => boolean;
}

const n = (value: number) => formatNumber(value);
/** 1000 → "1e3", so ids stay readable in a save file. */
const exp = (value: number) => `1e${Math.round(Math.log10(value))}`;
const cookies = (value: number) => `${n(value)} ${value === 1 ? "cookie" : "cookies"}`;

/* ---------------------------------------------------------------- baking */

const BAKED: [amount: number, name: string][] = [
  [1, "First crumb"],
  [1e3, "Kneads more"],
  [1e5, "Half-baked"],
  [1e6, "Fresh out of the oven"],
  [1e8, "Neighbourhood favourite"],
  [1e9, "Talk of the town"],
  [1e10, "Household name"],
  [1e11, "Big in cookies"],
  [1e12, "National treasure"],
  [1e13, "World famous"],
  [1e14, "Interplanetary snack"],
  [1e15, "Galactic appetite"],
  [1e16, "Universal appeal"],
  [1e17, "Multiversal"],
  [1e18, "Beyond counting"],
  [1e19, "Too many cookies"],
  [1e20, "Far too many cookies"],
  [1e21, "Crumbs of infinity"],
  [1e22, "Cookie singularity"],
  [1e23, "Post-cookie economy"],
  [1e24, "Cookie cosmology"],
  [1e25, "Heat death of the oven"],
  [1e26, "Endless batch"],
  [1e27, "Still baking"],
  [1e28, "Why stop now"],
  [1e29, "Cookie eternal"],
  [1e30, "Beyond cookies"],
];

const PER_SECOND: [amount: number, name: string][] = [
  [1, "Warming up"],
  [10, "Steady stream"],
  [100, "Cottage industry"],
  [1e3, "Cookie machine"],
  [1e4, "Mass production"],
  [1e5, "Cookie river"],
  [1e6, "Cookie flood"],
  [1e7, "Cookie tidal wave"],
  [1e8, "Cookie hurricane"],
  [1e9, "Cookie supernova"],
  [1e10, "Cookie pulsar"],
  [1e11, "Cookie quasar"],
  [1e12, "Cookie black hole"],
  [1e13, "Cookie big bang"],
  [1e14, "Cookie multiverse"],
  [1e15, "Faster than light"],
  [1e16, "Improbability drive"],
  [1e17, "Beyond physics"],
  [1e18, "Unmeasurable"],
  [1e19, "The oven of creation"],
  [1e20, "Omnibake"],
];

const HANDMADE: [amount: number, name: string][] = [
  [1e3, "Finger workout"],
  [1e5, "Repetitive strain"],
  [1e7, "Click marathon"],
  [1e9, "Click olympiad"],
  [1e11, "Clicking legend"],
  [1e13, "The mouse remembers"],
  [1e15, "Click of the gods"],
  [1e17, "Clickquake"],
  [1e19, "Clickpocalypse"],
  [1e21, "The final click"],
];

/* ------------------------------------------------------------- buildings */

export const BUILDING_MILESTONES = [1, 50, 100, 150, 200] as const;

const BUILDING_NAMES: Record<string, [string, string, string, string, string]> = {
  cursor: ["Point and click", "Fifty fingers", "Hundred hands", "All thumbs", "Finger food"],
  grandma: ["Nana's recipe", "Bingo night", "Retirement village", "Knitting circle", "Family reunion"],
  farm: ["Green thumb", "Cash crop", "Bumper harvest", "Breadbasket", "Amber waves of dough"],
  mine: ["Strike it rich", "Deep seams", "Hollow earth", "Core sample", "Journey to the centre"],
  factory: ["Clocking in", "Assembly line", "Heavy industry", "Smokestack skyline", "Fully automated"],
  bank: ["Opening an account", "Compound interest", "Too big to fail", "Offshore dough", "Central bank"],
  temple: ["Humble shrine", "Pilgrimage", "Holy crumbs", "Sacred texts", "Pantheon"],
  wizard: ["Abracadabra", "Spellbound", "Grand conjurer", "Arcane academy", "Archmage"],
  shipment: ["Liftoff", "Supply run", "Trade routes", "Interstellar freight", "The final frontier"],
  alchemy: ["Bubbling flasks", "Philosopher's scone", "Golden ratio", "Elixir of dough", "Magnum opus"],
  portal: ["Doorway", "The other side", "Dimension hopper", "Rift valley", "Doors of perception"],
  timemachine: ["Back to the bakery", "Paradox free", "Butterfly effect", "Time loop", "End of history"],
  antimatter: ["Matter of fact", "Annihilation", "Critical mass", "Event horizon", "Big crunch"],
  prism: ["Refraction", "Spectrum", "Full colour", "Photon baker", "Let there be light"],
  chancemaker: ["Beginner's luck", "Lucky streak", "Against the odds", "Four-leaf field", "Fate, sealed"],
  fractal: ["Self-similar", "Infinite coastline", "Recursion", "Mandelbake", "Turtles all the way down"],
  console: ["Hello, world", "Works on my machine", "Ship it", "Stack overflow", "Legacy code"],
  idleverse: ["Pocket universe", "Many worlds", "Multiverse theory", "Cosmic sprawl", "Everything everywhere"],
  cortex: ["Big brain", "Brainstorm", "Mind over batter", "Collective unconscious", "Enlightenment"],
  you: ["Meet yourself", "Crowd of you", "Hall of mirrors", "Self-made", "Only you"],
};

const TOTAL_OWNED: [count: number, name: string][] = [
  [100, "Small business"],
  [500, "Local chain"],
  [1000, "Corporation"],
  [2000, "Conglomerate"],
  [3000, "Empire"],
  [4000, "Monopoly"],
];

const UPGRADES_BOUGHT: [count: number, name: string][] = [
  [20, "Tinkerer"],
  [50, "Improver"],
  [100, "Optimiser"],
  [200, "Perfectionist"],
  [300, "Nothing left to buy"],
];

/* ---------------------------------------------------------------- golden */

const GOLDEN: [count: number, name: string][] = [
  [1, "Lucky find"],
  [7, "Seven for luck"],
  [27, "Charmed life"],
  [77, "Fortune's favourite"],
  [777, "Jackpot"],
  [7777, "Midas touch"],
];

/* ------------------------------------------------------------------ list */

/** Rank 0 is the most expensive building. */
const byRank = (c: AchievementContext, need: (rank: number) => number) =>
  c.owned.every((count, index) => count >= need(c.owned.length - 1 - index));

export const ACHIEVEMENTS: readonly Achievement[] = [
  ...BAKED.map(([amount, name]): Achievement => ({
    id: `baked-${exp(amount)}`,
    name,
    desc: `Bake ${cookies(amount)} in one run.`,
    group: "baking",
    test: (c) => c.baked >= amount,
  })),
  ...PER_SECOND.map(([amount, name]): Achievement => ({
    id: `cps-${exp(amount)}`,
    name,
    desc: `Bake ${cookies(amount)} per second.`,
    group: "baking",
    test: (c) => c.cps >= amount,
  })),
  ...HANDMADE.map(([amount, name]): Achievement => ({
    id: `handmade-${exp(amount)}`,
    name,
    desc: `Make ${cookies(amount)} by clicking in one run.`,
    group: "baking",
    test: (c) => c.handmade >= amount,
  })),
  ...BUILDINGS.flatMap((building, index) =>
    BUILDING_MILESTONES.map(
      (count, m): Achievement => ({
        id: `own-${building.id}-${count}`,
        name: BUILDING_NAMES[building.id][m],
        desc: `Own ${n(count)} ${count === 1 ? building.single : building.plural}.`,
        group: "buildings",
        test: (c) => c.owned[index] >= count,
      }),
    ),
  ),
  ...TOTAL_OWNED.map(([count, name]): Achievement => ({
    id: `owned-${count}`,
    name,
    desc: `Own ${n(count)} buildings.`,
    group: "buildings",
    test: (c) => c.totalOwned >= count,
  })),
  {
    id: "full-set",
    name: "Full set",
    desc: "Own at least one of every building.",
    group: "buildings",
    test: (c) => byRank(c, () => 1),
  },
  {
    id: "powers-of-two",
    name: "Powers of two",
    desc: "Own at least 1 of the most expensive building, 2 of the next, 4 of the next, and so on, up to 128.",
    group: "buildings",
    test: (c) => byRank(c, (rank) => Math.min(2 ** rank, 128)),
  },
  {
    id: "base-ten",
    name: "Base ten",
    desc: "Own at least 10 of the most expensive building, 20 of the next, 30 of the next, and so on.",
    group: "buildings",
    test: (c) => byRank(c, (rank) => 10 * (rank + 1)),
  },
  {
    id: "centennial",
    name: "Centennial",
    desc: "Own at least 100 of every building.",
    group: "buildings",
    test: (c) => byRank(c, () => 100),
  },
  {
    id: "sesquicentennial",
    name: "Sesquicentennial",
    desc: "Own at least 150 of every building.",
    group: "buildings",
    test: (c) => byRank(c, () => 150),
  },
  ...UPGRADES_BOUGHT.map(([count, name]): Achievement => ({
    id: `upgrades-${count}`,
    name,
    desc: `Buy ${n(count)} upgrades in one run.`,
    group: "other",
    test: (c) => c.upgrades >= count,
  })),
  ...GOLDEN.map(([count, name]): Achievement => ({
    id: `golden-${count}`,
    name,
    desc: count === 1 ? "Click a golden cookie." : `Click ${n(count)} golden cookies.`,
    group: "golden",
    test: (c) => c.goldenClicks >= count,
  })),
  { id: "quick-draw", name: "Quick draw", desc: "Click a golden cookie within a second of it appearing.", group: "golden" },
  { id: "just-in-time", name: "Just in time", desc: "Click a golden cookie in the last second before it fades.", group: "golden" },
  {
    id: "perfect-storm",
    name: "Perfect storm",
    desc: "Have a frenzy and a click frenzy going at the same time.",
    group: "golden",
    test: (c) => c.frenzy && c.clickFrenzy,
  },
  ...([1, 5, 10] as const).map(
    (count): Achievement => ({
      id: `ascend-${count}`,
      name: { 1: "Rebirth", 5: "Old soul", 10: "Wheel of dough" }[count],
      desc: count === 1 ? "Ascend for the first time." : `Ascend ${count} times.`,
      group: "legacy",
      test: (c) => c.ascensions >= count,
    }),
  ),
  ...([100, 1000, 10000] as const).map(
    (level): Achievement => ({
      id: `prestige-${level}`,
      name: { 100: "Heavenly", 1000: "Saintly", 10000: "Divine" }[level],
      desc: `Reach prestige level ${n(level)}.`,
      group: "legacy",
      test: (c) => c.prestige >= level,
    }),
  ),
  { id: "how-could-you", name: "How could you", desc: "Sell a grandma.", group: "other" },
  {
    id: "hands-off",
    name: "Hands off",
    desc: "Bake 1 million cookies in one run with no more than 15 cookie clicks.",
    group: "other",
    test: (c) => c.baked >= 1e6 && c.clicks <= 15,
  },
  {
    id: "look-no-hands",
    name: "Look, no hands",
    desc: "Bake 1 million cookies in one run without clicking the cookie once.",
    group: "other",
    test: (c) => c.baked >= 1e6 && c.clicks === 0,
  },
  {
    id: "purist",
    name: "Purist",
    desc: "Bake 1 billion cookies in one run without buying a single upgrade.",
    group: "other",
    test: (c) => c.baked >= 1e9 && c.upgrades === 0,
  },
  ...([35, 25, 15] as const).map(
    (minutes, i): Achievement => ({
      id: `speed-bake-${i + 1}`,
      name: ["Speed bake", "Speedier bake", "Speediest bake"][i],
      desc: `Bake 1 million cookies within ${minutes} minutes of starting a run.`,
      group: "other",
      test: (c) => c.baked >= 1e6 && c.runSeconds <= minutes * 60,
    }),
  ),
  {
    id: "hot-off-the-press",
    name: "Hot off the press",
    desc: "Click the news 50 times.",
    group: "other",
    test: (c) => c.newsClicks >= 50,
  },
];

export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, Achievement> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Every achievement is 4% milk, so 25 of them fill the glass once. */
export const milkFor = (achievements: number) => achievements / 25;
