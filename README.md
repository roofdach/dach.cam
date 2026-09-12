# personal site

a small, editorial homepage with five working projects behind it. nothing on the page is a screenshot: every preview is the real thing, running, and the title of each project opens the full version.

## running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
npm run lint
npm run check    # the logic checks, no framework
```

## the projects

| | what it is | here | on its own |
| --- | --- | --- | --- |
| **palette** | one colour in, an eleven-step tailwind v4 scale out, kept inside srgb and checked for contrast | `/work/palette` | [source](https://github.com/roofdach/palette) |
| **pulse** | a developer analytics dashboard on generated data, or on a real public repository read straight from github's api | `/work/pulse` | [source](https://github.com/roofdach/pulse) |
| **together** | a shared document over a real sequence crdt. anyone with the link edits the same copy | `/work/together` | [source](https://github.com/roofdach/together) |
| **snip** | eight conversions — json, base64, url, colour, hash, jwt, time, text — done entirely in the browser | `/work/snip` | [source](https://github.com/roofdach/snip) |
| **field** | a grid of glyphs standing in for pixels, exportable as a react component, an html file or an svg | `/work/field` | [source](https://github.com/roofdach/field) |

each project also lives in a repository of its own as a standalone app — clone, `npm install`, `npm run dev`. the copy here and the copy there are the same code; the site is where they run.

pick a colour in **palette** and tick "use this colour across the site" and the whole site follows it: links, charts, focus rings and the text selection. it writes two values, one per colour scheme, and an inline script applies them before the first paint so there is no flash of the old colour.

each project's homepage preview and its full version share the same code. the conversions in `snip`, the simulation in `field`, the curve maths in `pulse` and the colour maths behind `palette` each exist once, in `lib/`.

## how a few of them work

**together** is the only one with a server. the document is a sequence crdt: every character carries a fractional key that sorts it between its neighbours, and a delete carries a character's id rather than a position. tabs read over an event stream (`GET /api/together`) and write with a small post, and the server keeps the room's operation log so whoever arrives next gets the document as it stands. rooms live in memory and are forgotten ten minutes after the last person leaves; `?room=anything` makes a new one. it is one server's memory, so it wants redis or a durable object before it wants a second instance.

**pulse** normalises generated data and a real github repository into one `Dataset`, so every panel is written once. a real repository costs about six anonymous api requests out of the sixty an hour github allows.

**field** is one number per cell: a standing wave, plus the pointer, plus any live ripples. the stencil is text rasterised at grid resolution and added to that number, which is why letters bend when a ripple passes through them. the same simulation renders to svg on the server, without a font, using a 5×7 bitmap alphabet.

**palette** works in oklch. when a hue cannot be that colourful at a given lightness, chroma is reduced until it fits rather than the channels being clipped — clipping is what makes a purple quietly turn blue at the dark end. the accent it hands the rest of the site is step 600 on a light page and step 400 on a dark one.

## the link preview

`/og` renders a frame of `field` with the domain stencilled into it, and reads that domain from the request. sharing the same site as `dach.cam` or as `dachh.cc` previews as whichever one was sent, and a new domain needs no code change. the cost is that pages render per request rather than being prerendered, because the metadata has to see the request to know which name to use.

## making it yours

everything personal lives in [`config/site.ts`](config/site.ts). any link left as `""` doesn't render, and the discord id is never shown in the ui. `url` is only a fallback for when there is no request to read a domain from.

for the discord sentence in the introduction to work, your account needs to be in the [lanyard discord server](https://discord.gg/lanyard) so lanyard can see your presence.

## layout

```
app/                  layout, page, global styles
app/api/together/     the event stream and post endpoint for the shared document
app/og/               the link preview image
app/work/<project>/   the five full versions
components/           the site
components/apps/      the full versions
components/previews/  the homepage demos
lib/accent.ts         the site accent, as chosen in palette
lib/color.ts          colour maths, shared by snip and palette
lib/field/            simulation, svg renderer, bitmap alphabet, code export
lib/palette/          the eleven-step scale
lib/pulse/            dataset, aggregation, chart maths, github
lib/snip/             the conversions
lib/together/         the crdt, the protocol, the client transport
lib/lanyard/          client, presence logic, types, hook
scripts/check.mts     one runnable check for all of the above
```
