/**
 * Words to hang, and what counts as a letter. The words are everyday,
 * guessable and fine for a classroom, and each comes with its category,
 * which is the clue everyone gets. None has two spellings people argue
 * about, so a go at the whole word is only ever wrong for being wrong. The
 * host can add their own on top, or play with only their own.
 */

export interface Word {
  text: string;
  /** The clue shown with it; null for one of the host's own. */
  category: string | null;
}

const LISTS: Record<string, string> = {
  animals: `
    alligator, armadillo, badger, beaver, buffalo, camel, cheetah, chimpanzee, crocodile, dolphin, donkey, elephant,
    flamingo, giraffe, gorilla, guinea pig, hamster, hedgehog, hippopotamus, jaguar, jellyfish, kangaroo, killer whale,
    koala, leopard, lobster, meerkat, octopus, ostrich, panther, parrot, peacock, pelican, penguin, polar bear,
    porcupine, rabbit, raccoon, reindeer, rhinoceros, salmon, scorpion, sea lion, seahorse, squirrel, tortoise, walrus,
    woodpecker, zebra`,
  food: `
    apple pie, avocado, bagel, banana, biscuit, broccoli, burrito, butter, cabbage, carrot, cauliflower, cheesecake,
    chocolate, coconut, croissant, cucumber, dumpling, fish and chips, garlic bread, grapefruit, hamburger, hot dog,
    ice cream, jelly bean, lemonade, lettuce, mushroom, noodles, pancake, pineapple, popcorn, porridge, potato, pretzel,
    pumpkin, raspberry, sandwich, sausage, spaghetti, strawberry, sweetcorn, tomato, waffle, watermelon`,
  "around the house": `
    alarm clock, armchair, bathtub, bookshelf, bucket, candle, carpet, ceiling, chimney, cupboard, curtains, cushion,
    dishwasher, doorbell, drawer, freezer, fridge, frying pan, hairdryer, kettle, ladder, lampshade, mattress,
    microwave, mirror, pillow, radiator, remote control, saucepan, shower, sofa, staircase, teapot, television, toaster,
    toothbrush, towel, vacuum cleaner, wardrobe, washing machine, window`,
  jobs: `
    architect, baker, barber, builder, butcher, carpenter, cashier, dentist, detective, doctor, electrician, engineer,
    farmer, firefighter, florist, gardener, hairdresser, journalist, judge, lawyer, librarian, lifeguard, magician,
    mechanic, nurse, photographer, pilot, plumber, police officer, referee, sailor, scientist, teacher, vet, waiter,
    zookeeper`,
  "sport and games": `
    archery, athletics, badminton, baseball, basketball, bowling, boxing, chess, cricket, cycling, darts, diving,
    fencing, football, gaelic football, golf, gymnastics, handball, hide and seek, high jump, hockey, hurling, javelin,
    judo, karate, marathon, netball, rowing, rugby, sailing, skiing, snooker, snowboarding, surfing, swimming,
    table tennis, tennis, tug of war, volleyball, wrestling`,
  "nature and weather": `
    avalanche, blizzard, canyon, cliff, coral reef, desert, earthquake, forest, glacier, hailstone, hurricane,
    iceberg, island, jungle, lightning, meadow, mountain, puddle, rainbow, river, rock pool, sand dune, sandstorm,
    snowflake, sunshine, swamp, thunder, tornado, tsunami, valley, volcano, waterfall, whirlpool`,
  space: `
    alien, asteroid, astronaut, black hole, comet, constellation, crater, eclipse, flying saucer, galaxy, gravity,
    jupiter, mars, mercury, meteor, milky way, nebula, neptune, orbit, planet, rocket, satellite, saturn,
    shooting star, solar system, space station, spaceship, supernova, telescope, universe, venus`,
  "getting around": `
    ambulance, bicycle, bulldozer, cable car, canoe, caravan, double decker, ferry, fire engine, forklift, glider,
    helicopter, hot air balloon, hovercraft, kayak, lorry, minibus, monorail, motorbike, parachute, rickshaw,
    roller skates, sailboat, scooter, skateboard, space shuttle, speedboat, steam train, submarine, taxi, tractor,
    tram, unicycle, yacht, zeppelin`,
  clothes: `
    apron, bandana, baseball cap, beanie, blazer, boots, bow tie, bracelet, cardigan, dressing gown, dungarees,
    earrings, flip flops, gloves, hoodie, jacket, jeans, jumper, leggings, mittens, necklace, overalls, raincoat,
    sandals, scarf, school uniform, shorts, slippers, socks, sunglasses, sweatshirt, swimsuit, top hat, tracksuit,
    trousers, tuxedo, waistcoat, wellies, wristwatch`,
  music: `
    accordion, bagpipes, banjo, bass guitar, cello, choir, clarinet, concert, cymbals, dance floor, disco, drum kit,
    guitar, harmonica, harp, headphones, karaoke, keyboard, lullaby, melody, microphone, orchestra, piano, rhythm,
    rock band, saxophone, tambourine, trombone, trumpet, tuba, ukulele, violin, xylophone`,
  school: `
    backpack, calculator, classroom, compass, crayon, detention, dictionary, exercise book, field trip, geography,
    glue stick, headteacher, highlighter, history, homework, lunchbox, notebook, paintbrush, pencil case, playground,
    protractor, ruler, school bus, science, scissors, sharpener, spelling test, sports day, stapler, textbook,
    timetable, whiteboard`,
  "magic and monsters": `
    broomstick, cauldron, crystal ball, dinosaur, dragon, fairy, ghost, giant, goblin, haunted house,
    invisibility cloak, knight, magic wand, mermaid, monster, mummy, ogre, phoenix, pirate, potion, princess, robot,
    skeleton, spell book, superhero, time machine, treasure chest, troll, unicorn, vampire, werewolf, witch, wizard,
    zombie`,
  places: `
    airport, aquarium, bakery, beach, bowling alley, bus stop, car park, castle, cinema, circus, factory, farm,
    fire station, funfair, hospital, hotel, igloo, library, lighthouse, museum, palace, police station, post office,
    pyramid, restaurant, skyscraper, stadium, supermarket, swimming pool, train station, treehouse, water park,
    windmill, zoo`,
  countries: `
    argentina, australia, austria, belgium, brazil, canada, chile, china, colombia, cuba, denmark, egypt, finland,
    france, germany, ghana, greece, iceland, india, indonesia, ireland, italy, jamaica, japan, kenya, madagascar,
    mexico, mongolia, morocco, nepal, netherlands, new zealand, nigeria, norway, pakistan, peru, philippines, poland,
    portugal, singapore, south africa, spain, sweden, switzerland, thailand, vietnam`,
};

export const CATEGORIES: readonly string[] = Object.keys(LISTS);

export const WORDS: readonly Word[] = Object.entries(LISTS).flatMap(([category, list]) =>
  list
    .split(",")
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, category })),
);

/** Wrong goes before you're hanged: a head, a body, two arms, two legs. */
export const LIVES = 6;

/** The letters of a word, the part that's guessed: everything else in it shows from the start. */
export const lettersOf = (text: string) => text.replace(/[^a-z]/g, "");

/** The word as someone sees it: "_" for every letter they haven't found. */
export function maskOf(word: string, found: ReadonlySet<string>): string {
  return Array.from(word, (ch) => (ch >= "a" && ch <= "z" && !found.has(ch) ? "_" : ch)).join("");
}

/** Letters that don't come apart into a letter and an accent. */
const FOLDS: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };

/** Lowercase a to z, digits, spaces, hyphens and apostrophes, however it was typed: "Seán's" is "sean's". */
function tidy(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (ch) => FOLDS[ch])
    .replace(/[‘’`]/g, "'")
    .replace(/[^a-z0-9 '-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A host's word, tidied, or null: 3 to 30 characters, at least three of them letters. */
export function cleanWord(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const word = tidy(value);
  return word.length <= 30 && lettersOf(word).length >= 3 ? word : null;
}

/** A guess as typed: one letter, or a go at the whole word; null if it has no letters in it. */
export function cleanGuess(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const guess = tidy(value).slice(0, 40).trim();
  const letters = lettersOf(guess);
  if (letters.length === 0) return null;
  return letters.length === 1 ? letters : guess;
}

/** Whether a go at the whole word is it, however it's spaced: "icecream" is "ice cream". */
export const sameWord = (guess: string, word: string) => lettersOf(guess) === lettersOf(word);
