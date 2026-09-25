import { BUILDINGS, CURSOR, GRANDMA } from "./buildings.ts";

/**
 * Everything that can be bought once. Most of it is generated from a few
 * tables, so prices and unlocks follow one rule each rather than three hundred
 * hand-typed numbers.
 */

export type UpgradeKind =
  | "fingers"
  | "thousand-fingers"
  | "finger-multiplier"
  | "tier"
  | "synergy"
  | "mouse"
  | "cookie"
  | "kitten"
  | "golden";

export type Requirement =
  | { kind: "owned"; building: number; count: number }
  /** Fifteen of the building and a grandma to go with them. */
  | { kind: "synergy"; building: number }
  | { kind: "handmade"; amount: number }
  | { kind: "baked"; amount: number }
  | { kind: "achievements"; count: number }
  | { kind: "golden"; count: number };

export interface Upgrade {
  id: string;
  name: string;
  kind: UpgradeKind;
  icon: string;
  price: number;
  /** What it does, in a sentence. */
  effect: string;
  quote?: string;
  requires: Requirement;
  /** For tier and synergy upgrades, the building they belong to. */
  building?: number;
  /**
   * cookie: percent added to production. kitten: production added per 100%
   * of milk. thousand-fingers: cookies added per building. finger-multiplier:
   * what it multiplies that by.
   */
  power?: number;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/* ---------------------------------------------------------------- fingers */

const FINGER_DRAFTS: Omit<Upgrade, "icon" | "effect">[] = [
  {
    id: "nimble-fingers",
    name: "Nimble fingers",
    kind: "fingers",
    price: 100,
    requires: { kind: "owned", building: CURSOR, count: 1 },
    quote: "Stretch first.",
  },
  {
    id: "hand-cream",
    name: "Hand cream",
    kind: "fingers",
    price: 500,
    requires: { kind: "owned", building: CURSOR, count: 1 },
    quote: "Smells faintly of cookies. Everything does, now.",
  },
  {
    id: "two-handed",
    name: "Two-handed clicking",
    kind: "fingers",
    price: 10_000,
    requires: { kind: "owned", building: CURSOR, count: 10 },
    quote: "Why were you only using one?",
  },
  {
    id: "thousand-fingers",
    name: "Thousand fingers",
    kind: "thousand-fingers",
    price: 100_000,
    power: 0.1,
    requires: { kind: "owned", building: CURSOR, count: 25 },
    quote: "Clickity.",
  },
  ...(
    [
      ["Million", 1e7, 50, 5],
      ["Billion", 1e8, 100, 10],
      ["Trillion", 1e9, 150, 20],
      ["Quadrillion", 1e10, 200, 20],
      ["Quintillion", 1e13, 250, 20],
      ["Sextillion", 1e16, 300, 20],
      ["Septillion", 1e19, 350, 20],
      ["Octillion", 1e22, 400, 20],
      ["Nonillion", 1e25, 450, 20],
    ] as const
  ).map(
    ([word, price, count, power]): Omit<Upgrade, "icon" | "effect"> => ({
      id: `${word.toLowerCase()}-fingers`,
      name: `${word} fingers`,
      kind: "finger-multiplier",
      price,
      power,
      requires: { kind: "owned", building: CURSOR, count },
    }),
  ),
];

const FINGERS: Upgrade[] = FINGER_DRAFTS.map((upgrade) => ({
  ...upgrade,
  icon: BUILDINGS[CURSOR].icon,
  effect:
    upgrade.kind === "fingers"
      ? "The mouse and cursors are twice as efficient."
      : upgrade.kind === "thousand-fingers"
        ? "The mouse and cursors gain +0.1 cookies for each building that isn't a cursor."
        : `Multiplies the gain from Thousand fingers by ${upgrade.power}.`,
}));

/* ------------------------------------------------------------------ tiers */

/** How many of a building unlock each tier, and what it costs as a multiple of the building's price. */
export const TIERS = [
  { word: "Sturdy", owned: 1, cost: 10 },
  { word: "Polished", owned: 5, cost: 50 },
  { word: "Reinforced", owned: 25, cost: 500 },
  { word: "Gilded", owned: 50, cost: 50_000 },
  { word: "Enchanted", owned: 100, cost: 5e6 },
  { word: "Clockwork", owned: 150, cost: 5e8 },
  { word: "Quantum", owned: 200, cost: 5e11 },
  { word: "Starforged", owned: 250, cost: 5e14 },
  { word: "Eldritch", owned: 300, cost: 5e17 },
  { word: "Paradox", owned: 350, cost: 5e20 },
  { word: "Transcendent", owned: 400, cost: 5e23 },
  { word: "Impossible", owned: 450, cost: 5e26 },
] as const;

const TIERED: Upgrade[] = BUILDINGS.flatMap((building, index) =>
  index === CURSOR
    ? []
    : TIERS.map(
        (tier, t): Upgrade => ({
          id: `${building.id}-${t + 1}`,
          name: `${tier.word} ${building.tool}`,
          kind: "tier",
          icon: building.icon,
          price: building.price * tier.cost,
          effect: `${capitalise(building.plural)} are twice as efficient.`,
          requires: { kind: "owned", building: index, count: tier.owned },
          building: index,
        }),
      ),
);

/* -------------------------------------------------------------- synergies */

const SYNERGY_NAMES: Record<string, string> = {
  farm: "Farmer grandmas",
  mine: "Miner grandmas",
  factory: "Foreman grandmas",
  bank: "Banker grandmas",
  temple: "Priestess grandmas",
  wizard: "Witch grandmas",
  shipment: "Astronaut grandmas",
  alchemy: "Alchemist grandmas",
  portal: "Otherworldly grandmas",
  timemachine: "Great-great-grandmas",
  antimatter: "Anti-grandmas",
  prism: "Prismatic grandmas",
  chancemaker: "Gambling grandmas",
  fractal: "Recursive grandmas",
  console: "Coder grandmas",
  idleverse: "Parallel grandmas",
  cortex: "Genius grandmas",
  you: "Mirror grandmas",
};

/** How many grandmas it takes to add 1% to a building with a synergy. */
export const grandmasPerPercent = (building: number) => building - 1;

const SYNERGIES: Upgrade[] = BUILDINGS.flatMap((building, index): Upgrade[] => {
  if (index <= GRANDMA) return [];
  const per = grandmasPerPercent(index);
  return [
    {
      id: `${building.id}-grandmas`,
      name: SYNERGY_NAMES[building.id],
      kind: "synergy",
      icon: BUILDINGS[GRANDMA].icon,
      price: building.price * 50,
      effect: `Grandmas are twice as efficient. ${capitalise(building.plural)} gain +1% production per ${
        per === 1 ? "grandma" : `${per} grandmas`
      }.`,
      requires: { kind: "synergy", building: index },
      building: index,
    },
  ];
});

/* ----------------------------------------------------------------- mice */

const MICE: Upgrade[] = [
  "Plastic",
  "Iron",
  "Titanium",
  "Adamantium",
  "Unobtainium",
  "Meteorite",
  "Moonsilver",
  "Sunforged",
  "Neutronium",
  "Dark matter",
  "Hyperalloy",
  "Unbreakable",
].map((material, i) => ({
  id: `${material.toLowerCase().replace(" ", "-")}-mouse`,
  name: `${material} mouse`,
  kind: "mouse",
  icon: "🖱️",
  price: 5e4 * 100 ** i,
  effect: "Clicking gains +1% of your cookies per second.",
  requires: { kind: "handmade", amount: 1e3 * 100 ** i },
}));

/* ---------------------------------------------------------------- cookies */

const COOKIE_LIST: [name: string, price: number, power: number][] = [
  ["Butter cookies", 1e6, 1],
  ["Sugar cookies", 5e6, 1],
  ["Oatmeal raisin cookies", 1e7, 1],
  ["Peanut butter cookies", 5e7, 1],
  ["Coconut macaroons", 1e8, 2],
  ["Snickerdoodles", 5e8, 2],
  ["White chocolate cookies", 1e9, 2],
  ["Macadamia nut cookies", 5e9, 2],
  ["Double-chip cookies", 1e10, 2],
  ["Shortbread fingers", 5e10, 2],
  ["Gingersnaps", 1e11, 3],
  ["Biscotti", 5e11, 3],
  ["Speculoos", 1e12, 3],
  ["Stroopwafels", 5e12, 3],
  ["Florentines", 1e13, 3],
  ["Madeleines", 5e13, 3],
  ["Alfajores", 1e14, 4],
  ["Linzer cookies", 5e14, 4],
  ["Black and white cookies", 1e15, 4],
  ["Pfeffernüsse", 5e15, 4],
  ["Anzac biscuits", 1e16, 4],
  ["Thumbprint cookies", 1e17, 5],
  ["Chocolate crinkles", 1e18, 5],
  ["Rugelach", 1e19, 5],
  ["Kourabiedes", 1e20, 5],
  ["Polvorones", 1e21, 5],
  ["Brown butter cookies", 1e22, 5],
  ["Salted caramel cookies", 1e23, 5],
  ["Stardust cookies", 1e25, 5],
  ["The perfect cookie", 1e27, 10],
];

const COOKIES: Upgrade[] = COOKIE_LIST.map(([name, price, power]) => ({
  id: name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]+/g, "-"),
  name,
  kind: "cookie",
  icon: "🍪",
  price,
  power,
  effect: `Cookie production +${power}%.`,
  requires: { kind: "baked", amount: price / 20 },
}));

/* ---------------------------------------------------------------- kittens */

const KITTEN_LIST: [name: string, price: number, achievements: number, power: number, quote: string][] = [
  ["Kitten helpers", 9e6, 13, 0.1, "They mostly sit on the warm trays."],
  ["Kitten workers", 9e9, 25, 0.125, "Paid in cream, and worth every drop."],
  ["Kitten engineers", 9e13, 50, 0.15, "Designed a better oven. Then a better cat flap."],
  ["Kitten overseers", 9e16, 75, 0.175, "They watch everything. They have always watched everything."],
  ["Kitten managers", 9e19, 100, 0.2, "Called a meeting about naps. It was a very long meeting."],
  ["Kitten accountants", 9e22, 125, 0.2, "Knocks the ledgers off the desk, one page at a time."],
  ["Kitten specialists", 9e25, 150, 0.2, "Specialises in the sunny patch by the window."],
  ["Kitten experts", 9e28, 175, 0.2, "Knows exactly where the milk is kept."],
];

const KITTENS: Upgrade[] = KITTEN_LIST.map(([name, price, count, power, quote]) => ({
  id: name.toLowerCase().replace(" ", "-"),
  name,
  kind: "kitten",
  icon: "🐱",
  price,
  power,
  quote,
  effect: `Cookie production +${Math.round(power * 1000) / 10}% for every 100% of milk.`,
  requires: { kind: "achievements", count },
}));

/* ----------------------------------------------------------------- golden */

const GOLDEN: Upgrade[] = [
  {
    id: "lucky-day",
    name: "Lucky day",
    kind: "golden",
    icon: "✨",
    price: 777_777_777,
    effect: "Golden cookies appear twice as often and stay twice as long.",
    requires: { kind: "golden", count: 7 },
  },
  {
    id: "serendipity",
    name: "Serendipity",
    kind: "golden",
    icon: "✨",
    price: 77_777_777_777,
    effect: "Golden cookies appear twice as often and stay twice as long.",
    requires: { kind: "golden", count: 27 },
  },
  {
    id: "get-lucky",
    name: "Get lucky",
    kind: "golden",
    icon: "✨",
    price: 77_777_777_777_777,
    effect: "Golden cookie effects last twice as long.",
    requires: { kind: "golden", count: 77 },
  },
];

export const UPGRADES: readonly Upgrade[] = [
  ...FINGERS,
  ...TIERED,
  ...SYNERGIES,
  ...MICE,
  ...COOKIES,
  ...KITTENS,
  ...GOLDEN,
];

export const UPGRADE_BY_ID: ReadonlyMap<string, Upgrade> = new Map(UPGRADES.map((u) => [u.id, u]));

/** Lookups the production maths makes every frame, worked out once. */
export const FINGER_UPGRADES = FINGERS;
export const TIER_IDS: readonly (readonly string[])[] = BUILDINGS.map((_, index) =>
  TIERED.filter((u) => u.building === index).map((u) => u.id),
);
export const SYNERGY_IDS: readonly (string | null)[] = BUILDINGS.map(
  (_, index) => SYNERGIES.find((u) => u.building === index)?.id ?? null,
);
export const MOUSE_IDS: readonly string[] = MICE.map((u) => u.id);
export const COOKIE_UPGRADES: readonly Upgrade[] = COOKIES;
export const KITTEN_UPGRADES: readonly Upgrade[] = KITTENS;

/* --------------------------------------------------------------- heavenly */

export interface HeavenlyUpgrade {
  id: string;
  name: string;
  icon: string;
  /** In heavenly chips. */
  price: number;
  effect: string;
}

export const HEAVENLY: readonly HeavenlyUpgrade[] = [
  {
    id: "oven-left-on",
    name: "Oven left on",
    icon: "🔥",
    price: 1,
    effect:
      "While the game is closed, you keep baking at 5% of your usual rate for up to an hour, and a tenth of that after.",
  },
  { id: "heavenly-cookies", name: "Heavenly cookies", icon: "😇", price: 3, effect: "Cookie production +10%, for good." },
  {
    id: "guardian-angels",
    name: "Guardian angels",
    icon: "👼",
    price: 7,
    effect: "With the oven left on, bake another 10% of your usual rate while the game is closed.",
  },
  {
    id: "kitten-angels",
    name: "Kitten angels",
    icon: "🐱",
    price: 9,
    effect: "Cookie production +10% for every 100% of milk.",
  },
  {
    id: "archangels",
    name: "Archangels",
    icon: "👼",
    price: 49,
    effect: "With the oven left on, bake another 10% of your usual rate while the game is closed.",
  },
  { id: "starter-kit", name: "Starter kit", icon: "👆", price: 50, effect: "Start every run with 10 cursors." },
  { id: "heavenly-luck", name: "Heavenly luck", icon: "✨", price: 77, effect: "Golden cookies appear 5% more often." },
  {
    id: "seraphim",
    name: "Seraphim",
    icon: "👼",
    price: 343,
    effect: "With the oven left on, bake another 10% of your usual rate while the game is closed.",
  },
  { id: "lasting-fortune", name: "Lasting fortune", icon: "✨", price: 777, effect: "Golden cookie effects last 10% longer." },
  { id: "starter-kitchen", name: "Starter kitchen", icon: "👵", price: 5_000, effect: "Start every run with 5 grandmas." },
  { id: "decisive-fate", name: "Decisive fate", icon: "✨", price: 7_777, effect: "Golden cookies stay 5% longer." },
  { id: "divine-discount", name: "Divine discount", icon: "🏷️", price: 99_999, effect: "Buildings are 1% cheaper." },
  { id: "divine-sales", name: "Divine sales", icon: "🏷️", price: 99_999, effect: "Upgrades are 1% cheaper." },
];

export const HEAVENLY_BY_ID: ReadonlyMap<string, HeavenlyUpgrade> = new Map(HEAVENLY.map((u) => [u.id, u]));
