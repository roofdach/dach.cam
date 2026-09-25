/**
 * The news ticker. A headline only turns up once it could be true: nobody
 * reports on your time machines before you have one.
 */

export interface NewsContext {
  /** Baked across every run. */
  bakedAllTime: number;
  owned: readonly number[];
  goldenClicks: number;
  ascensions: number;
}

type Condition = (c: NewsContext) => boolean;

const always: Condition = () => true;
const early: Condition = (c) => c.bakedAllTime < 1e4;
const has = (building: number, count = 1): Condition => (c) => c.owned[building] >= count;
const baked = (amount: number): Condition => (c) => c.bakedAllTime >= amount;

const NEWS: [Condition, string][] = [
  [early, "You bake a cookie. It's alright."],
  [early, "Nobody has heard of your bakery yet. Your mum says it's lovely."],
  [early, "A neighbour asks what that smell is. It's cookies. Of course it's cookies."],
  [early, "Local person clicks cookie, cookie remains a cookie."],
  [always, "Scientists confirm cookies are 'probably' good for morale."],
  [always, "Milk prices steady; experts 'cautiously dunking'."],
  [always, "Survey finds nine out of ten cookies prefer being eaten warm."],
  [always, "Crumbs found in a suspicious number of keyboards."],
  [always, "Opinion: is it still a snack if there are this many?"],
  [has(0), "Cursors report clicking the cookie with 'unsettling enthusiasm'."],
  [has(0, 50), "Mouse shortage blamed on one bakery's cursor habit."],
  [has(1), "Grandma refuses to share the secret ingredient. It's butter. It's always butter."],
  [has(1, 10), "'Eat something,' says grandma, to the entire town."],
  [has(1, 50), "Grandmas unionise, demand longer knitting breaks and a second oven."],
  [has(2), "Farmers swap wheat for cookie crops. 'The harvest smells amazing,' says one."],
  [has(2, 25), "Scarecrows report record numbers of very full crows."],
  [has(3), "Miners strike chocolate. Literally."],
  [has(3, 25), "Geologists baffled by layers of shortbread in the Earth's crust."],
  [has(4), "Factory output so high the conveyor belts have asked for a holiday."],
  [has(4, 25), "Critics call new cookie factory 'too efficient'; factory takes it as a compliment."],
  [has(5), "Banks now accept cookies as currency. Exchange rate described as 'crumbly'."],
  [has(5, 25), "Economists warn of a cookie bubble. The bubble is delicious."],
  [has(6), "Archaeologists uncover ancient cookie; decline to share."],
  [has(6, 25), "Temple priests say the cookie gods are 'pleased, for now'."],
  [has(7), "Wizard turns frog into prince, then prince into cookie. 'Better,' says prince."],
  [has(7, 25), "Spell misfires, bakes cookies across the whole country. Nobody complains."],
  [has(8), "First cookie delivery from space arrives. Slightly crunchier than usual."],
  [has(8, 25), "Astronauts describe the cookie planet as 'mostly chocolate chips'."],
  [has(9), "Alchemists finally turn lead into gold, then gold into cookies. Progress."],
  [has(10), "Portal opens onto a dimension of dough. It smells unbelievably good in there."],
  [has(10, 25), "Something from the other side of the portal has asked for the recipe."],
  [has(11), "Time travellers deliver cookies from the day before they were eaten."],
  [has(11, 25), "Historians confused by cookies turning up in every century at once."],
  [has(12), "Physicists create the anti-cookie. It tastes of nothing and wants everything."],
  [has(13), "Sunlight now 40% cookie, say scientists, who seem pleased about it."],
  [has(14), "Local person finds a cookie in every pocket. 'Just lucky,' they say."],
  [has(15), "Mathematicians prove every cookie contains a smaller cookie."],
  [has(16), "Developers ship cookies to production on a Friday. It went fine."],
  [has(16, 25), "New framework released. It's cookies all the way down."],
  [has(17), "Parallel universe reports that it also has too many cookies."],
  [has(18), "Giant brain dreams of cookies; cookies appear. Brain asks for milk."],
  [has(19), "You meet yourself at the shops. You both buy cookies."],
  [(c) => c.goldenClicks > 0, "Golden cookie sightings on the rise. Experts advise: just click it."],
  [baked(1e9), "Your bakery is now visible from a passing aeroplane."],
  [baked(1e12), "Economists stop measuring the economy in money. It's all cookies now."],
  [baked(1e15), "The moon is now visibly crunchy."],
  [baked(1e18), "'Please, no more cookies,' says planet. More cookies arrive."],
  [baked(1e21), "Astronomers name a new galaxy after your bakery. It is shaped like a cookie."],
  [(c) => c.ascensions > 0, "Philosophers ask: if you start again, were the cookies ever really gone?"],
];

/** A headline that could be true right now, preferably not the one already showing. */
export function pickHeadline(context: NewsContext, random: () => number, current?: string): string {
  const pool = NEWS.filter(([when, text]) => text !== current && when(context)).map(([, text]) => text);
  if (pool.length === 0) return current ?? NEWS[4][1];
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
