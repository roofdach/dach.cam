# personal site

one page: a short introduction, a sentence about what i'm doing right now (read live from discord), a list of games, and a few links. the one game so far is a cookie clicker, at `/cookie`.

## running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
npm run lint
npm run check    # the logic checks, no framework
```

## making it yours

- [`config/site.ts`](config/site.ts) — name, age, location, the discord id, and the links at the bottom of the page. the discord id is never shown on the page.
- [`data/games.ts`](data/games.ts) — the games. each one is a title, one line of description and a link.

for the "right now i'm…" sentence to work, your account needs to be in the [lanyard discord server](https://discord.gg/lanyard) so lanyard can see your presence. until lanyard answers, the sentence stays hidden rather than guessing; if it never does, it says you're away from the keyboard.

## cookie

a cookie clicker, at `/cookie`. the twenty buildings cost and make what they do in cookie clicker, 15% dearer each, so the pacing is the one people know; everything else is written for this one. clicking, upgrades for every building, golden cookies (frenzy, lucky, click frenzy, and a boost from one of the buildings you have ten or more of), achievements and milk, and ascending, where a run's cookies turn into prestige and heavenly upgrades that carry over.

the game is plain functions in [`lib/cookie/`](lib/cookie) and the page only draws it, so everything that could quietly be wrong is checked by `npm run check`: prices, production, golden cookie timing and effects, saves, and a bot that plays a whole simulated day.

a few things it takes care of:

- **time is real time.** a background tab keeps baking, and a buff that ran out while you were away only counts for as long as it lasted. golden cookies only come while the game is on screen. with the right heavenly upgrade it bakes a little while closed, too.
- **saves never get lost.** the game saves every 30 seconds and whenever you leave, checks every field on the way back in, and puts a save it can't read aside instead of writing over it. saves export as text and import back.
- **one tab at a time.** a second tab asks the first to save and hand over, so two tabs can't overwrite each other's progress; the one left behind offers to take back over.

## the link preview

`/og` renders the domain the page was asked for, so sharing the site as `dach.cam` or as `dachh.cc` previews as whichever one was sent, and a new domain needs no code change. the cost is that pages render per request rather than being prerendered, because the metadata has to see the request to know which name to use. `url` in the config is only a fallback for when there is no request to read a domain from.

## layout

```
app/                  layout, page, global styles
app/cookie/           the cookie clicker's page
app/og/               the link preview image
components/           the presence sentence
components/cookie/    the game's screen, its loop, saving and tabs
config/site.ts        everything personal
data/games.ts         the games
lib/cookie/           the game itself: buildings, upgrades, achievements, the engine, saves
lib/lanyard/          client, presence logic, types, hook
lib/origin.ts         which domain a request came in on
scripts/check.mts     one runnable check for the logic above
```
