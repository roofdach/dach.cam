# personal site

one page: a short introduction, a sentence about what i'm doing right now (read live from discord), a list of games, and a few links. the games are a drawing game at `/draw`, a geoguessr at `/geo` and a cookie clicker at `/cookie`.

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

## geo

a geoguessr, at `/geo`. you're dropped into google street view somewhere, you look around and walk about, and you put a pin on the map where you think you are: up to 5,000 points a round, falling off with distance the way geoguessr's do. you can play five rounds alone on any of eleven maps (the world, the continents, and ireland, the uk, the us, japan and france), with or without a clock; play the daily, which is the same five places for everyone that day and can be shared as a row of squares; or make a room, send the code, and play together. the host picks the map, the rounds and the time; everyone gets the same places at the same moment, sees who has guessed, and after each round sees everyone's pins and the standings.

### setting it up

it needs two things, both free, both set once in vercel.

**1. two google maps keys, for street view.** street view is shown with google's maps embed api, which is free with no limit, and places are found with the street view metadata endpoint, which is also free and is how the game checks a spot has street view before sending anyone there. they get a key each, because they're kept in different places:

- the **page key** ends up in the page, which is how google's browser keys work. it's limited to your domains and to the embed api alone, which has no paid tier, so even a copy of it can't cost anything.
- the **server key** stays on vercel and is never sent to anyone. that matters, because the api the metadata endpoint belongs to (the street view static api) also sells street view pictures, and a key for that sitting in a page is the kind that gets lifted and billed. the site only ever uses it for metadata.

google still wants a billing account on file before it hands out keys, even when everything used is free.

1. in the [google cloud console](https://console.cloud.google.com/), make a project and give it a billing account.
2. under *apis & services → library*, enable the **maps embed api** and the **street view static api**.
3. under *apis & services → credentials*, create an api key for the page and edit it:
   - *application restrictions*: websites, with `https://dach.cam/*`, `https://www.dach.cam/*`, `https://dachh.cc/*`, `https://www.dachh.cc/*`, and `http://localhost:3000/*` for running it locally;
   - *api restrictions*: the maps embed api only.
4. create a second key for the server: no application restriction (vercel's servers don't have fixed addresses), and *api restrictions*: the street view static api only.
5. in vercel, under *settings → environment variables*, add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (the page key) and `GOOGLE_MAPS_SERVER_KEY` (the server key), then redeploy. for running it locally, put the same two lines in `.env.local`.

a budget alert on the billing account costs nothing and is a good backstop. if either key is missing, `/geo` says street view isn't set up; if google turns a key down, it says so, with google's reason, instead of breaking.

**2. a redis database, for multiplayer.** vercel's functions don't keep anything between requests, so rooms live in upstash redis.

1. in vercel, open the project's *storage* tab, create an **upstash for redis** database on the free plan, and connect it to the project. pick the region nearest the project's function region (washington, d.c. unless you've changed it).
2. redeploy. the connection details arrive as environment variables (`KV_REST_API_URL` and `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`) and are picked up by themselves.

without it, solo and the daily work and the multiplayer part of the page says it isn't set up. anywhere that isn't vercel (`npm run dev`, `npm start`) rooms are kept in memory, so multiplayer works locally with nothing to set up.

what it costs to run: nothing, within the free plans. an open room polls about once every two seconds per player, and the reply is shared through vercel's cdn, so a room costs roughly one function call and two redis commands a second however many are in it, plus one tiny request per player every twenty seconds. upstash's free 500,000 commands a month is a few dozen hours of rooms. the thing to keep an eye on with a whole class playing is vercel's included requests, since every poll counts, cached or not.

### how it works

- **finding places** happens in the browser, which asks the site's server (the one with the key) about a handful of spots at a time. a map is a weighted list of countries ([`lib/geo/maps.ts`](lib/geo/maps.ts)); a round picks a country, then a town in it by population, then a point somewhere around the town, and asks google for the nearest panorama. only google's own panoramas count (not people's uploaded photo spheres), and only ones no further from the town than its *reach*: how far you can go from that town without any chance of crossing a border. the reaches are worked out ahead of time from natural earth's 1:10m borders, so the game always knows what country a place is in without sending borders to the browser. the towns and reaches are in [`lib/geo/data/`](lib/geo/data), built by `npm run geo-data` from geonames and natural earth; run it again after changing the maps.
- **the daily** seeds that same search with the date, and everything random is drawn before any request goes out, so everyone gets the same places however their requests race.
- **street view** is google's own viewer in an iframe, so it runs as well as street view does anywhere, which on a school laptop is well. google prints the address in the frame's top corner and can't be asked not to, so the frame is taller than the screen and that strip hangs off the top. google's logo and terms along the bottom stay visible. street names painted on the road stay, as they do in any embed.
- **the map** you guess on is leaflet with carto's raster tiles, which is light on a laptop's graphics chip, and it falls back to openstreetmap's tiles if a school network blocks carto's.
- **multiplayer** stores nothing but an append-only log per room: who joined, what the host started, who guessed where, each stamped with the server's clock. everything else (whose turn it is, when a round ends, the scores) comes from replaying the log with a pure function, [`lib/geo/room.ts`](lib/geo/room.ts), so two people guessing at once can't overwrite each other and every replay agrees. rounds end at their deadline or as soon as everyone still in the room has guessed; a player who closes their tab is let go after a minute and can come back to the same seat and score. the view everyone gets hides where the round is and where others guessed until the round is over.

`npm run check` covers the scoring, the place finder and the server's lookups (with a pretend google), the room rules, and the multiplayer api end to end against an in-memory store and against a pretend upstash speaking its rest protocol.

street view imagery is google's. maps © openstreetmap contributors and carto. towns from [geonames](https://www.geonames.org/) (cc by 4.0), borders from [natural earth](https://www.naturalearthdata.com/).

## draw

a skribbl, at `/draw`. someone makes a room and reads out its code; everyone else goes to `/draw`, types their name and the four letters, and they're in, no link needed. the host picks two to five rounds and 60 to 120 seconds a drawing, and can add words of their own (in with the built-in ones, where one of every three offered is theirs, or only theirs). in a round everyone draws once: the drawer picks one of three words and draws it with a pen in four sizes, a paint bucket, 24 colours, undo and clear, while everyone else types guesses in the chat. a right guess scores more the sooner it comes; the drawer scores for how many get it. a guess one letter off gets a private "close!", a message that gives the word away is only shown to whoever typed it, and a letter is uncovered at half time and another at three quarters. two to twelve players; people can join a game that's already going and still get their turn.

it uses the same redis database as geo's rooms (step 2 under geo, above), and like geo it keeps rooms in memory anywhere that isn't vercel, so it works locally with nothing to set up.

### how it works

- **room codes** are four letters with no vowels (so no code spells anything) and none that look like numbers, for both games: 160,000 of them, each only taken while its room is open.
- **the rules** are the same idea as geo's rooms: an append-only log of what happened (joins, starts, word choices, right guesses), replayed by a pure function, [`lib/draw/room.ts`](lib/draw/room.ts), with the server's clock deciding when a choice times out, a drawing ends and the next turn starts. the words on offer and the hints come from a secret the room keeps on the server, so nothing in anyone's browser can tell the word early: everyone gets the same view, which has the word as blanks, and the drawer, and anyone who's guessed it, ask for the word separately.
- **chat and drawings** sit beside the log, in their own lists, so they never make the log long. the drawing is a list of small operations (a line through some points, a fill from a point, a clear, an undo of a stroke) on an 800 by 600 board, sent a few times a second as the drawer draws, and every other screen replays them onto its own board, drawn out over the next second so strokes move rather than jump. everyone asks for the drawing from a round number of operations so their requests match and the cdn can share one answer.

what it costs to run: while someone's drawing, each player asks for the room and the drawing about once a second, all with the same question so vercel's cdn answers them with one shared copy, and the drawer sends a batch of strokes two or three times a second. a game of four players and three rounds is roughly 8,000 to 12,000 redis commands, so upstash's free 500,000 a month covers around forty to sixty games. if it runs out, the rooms stop working until the month turns over. rooms clear themselves out a few hours after the last game, so there's never anything to delete; the limit is on requests, not storage.

`npm run check` covers the words and guess matching, the drawing operations and the paint bucket, the turn and scoring rules, and the api end to end in memory and against a pretend upstash.

## the link preview

`/og` renders the domain the page was asked for, so sharing the site as `dach.cam` or as `dachh.cc` previews as whichever one was sent, and a new domain needs no code change. the cost is that pages render per request rather than being prerendered, because the metadata has to see the request to know which name to use. `url` in the config is only a fallback for when there is no request to read a domain from.

## layout

```
app/                  layout, page, global styles
app/cookie/           the cookie clicker's page
app/draw/             draw's menu, and /draw/CODE for rooms
app/geo/              geo's menu, and /geo/CODE for rooms
app/api/draw/         draw's multiplayer api
app/api/geo/          geo's multiplayer api
app/og/               the link preview image
components/           the presence sentence
components/cookie/    the game's screen, its loop, saving and tabs
components/draw/      draw's screens: menu, lobby, the board and its tools, chat
components/game/      what the room games share: buttons, the server's clock, saving
components/geo/       geo's screens: menu, rounds, results, rooms, street view, maps
config/site.ts        everything personal
data/games.ts         the games
lib/cookie/           the game itself: buildings, upgrades, achievements, the engine, saves
lib/draw/             draw: the words, guess matching, drawing operations, the room rules, and the server side
lib/geo/              geo: maps, scoring, the place finder, the room rules, and the server side
lib/rooms/            what rooms share: codes, where they're stored, and replies
lib/lanyard/          client, presence logic, types, hook
lib/origin.ts         which domain a request came in on
lib/random.ts         seeded and secure random numbers
scripts/check.mts     one runnable check for the logic above
scripts/check-geo.mts the same for geo
scripts/check-draw.mts and for draw
scripts/fake-upstash.mts a pretend upstash for the checks
scripts/geo-data.mts  builds geo's towns and map sizes
```
