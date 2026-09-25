# personal site

one page: a short introduction, a sentence about what i'm doing right now (read live from discord), a list of projects, and a few links.

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
- [`data/projects.ts`](data/projects.ts) — the projects. each one is a title, one line of description and a link.

for the "right now i'm…" sentence to work, your account needs to be in the [lanyard discord server](https://discord.gg/lanyard) so lanyard can see your presence. until lanyard answers, the sentence stays hidden rather than guessing; if it never does, it says you're away from the keyboard.

## the link preview

`/og` renders the domain the page was asked for, so sharing the site as `dach.cam` or as `dachh.cc` previews as whichever one was sent, and a new domain needs no code change. the cost is that pages render per request rather than being prerendered, because the metadata has to see the request to know which name to use. `url` in the config is only a fallback for when there is no request to read a domain from.

## layout

```
app/                  layout, page, global styles
app/og/               the link preview image
components/           the presence sentence
config/site.ts        everything personal
data/projects.ts      the projects
lib/lanyard/          client, presence logic, types, hook
lib/origin.ts         which domain a request came in on
scripts/check.mts     one runnable check for the logic above
```
