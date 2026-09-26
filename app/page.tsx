import { DynamicPresence } from "@/components/DynamicPresence";
import { siteConfig } from "@/config/site";
import { games } from "@/data/games";
import { streetViewReady } from "@/lib/geo/server/lookup";

/** Links off the site open in a new tab; `mailto:` and the like don't need one. */
function newTab(href: string) {
  return /^https?:/.test(href) ? { target: "_blank", rel: "noreferrer" } : {};
}

export default function Home() {
  // Geo is only listed once its Google keys are in, rather than lead to a page saying it isn't set up.
  const listed = games.filter((game) => game.href !== "/geo" || streetViewReady());
  return (
    <div className="mx-auto w-full max-w-[36rem] px-6 py-24 sm:py-32">
      <main>
        <h1 className="sr-only">{siteConfig.name}</h1>

        <section aria-label="Introduction" className="space-y-5">
          <p>
            hey, i&rsquo;m {siteConfig.name}. i&rsquo;m {siteConfig.age}, i live in{" "}
            {siteConfig.location.toLowerCase()}, and i mostly build for the web. lately that means a lot of
            typescript, a lot of react, and a lot of tailwind.
          </p>
          <p>
            most of what i know i learned by building something slightly too ambitious and then asking ai why it
            broke. that&rsquo;s still the plan.
          </p>
          <DynamicPresence />
        </section>

        <section aria-labelledby="games" className="mt-16">
          <h2 id="games" className="text-muted">
            games
          </h2>
          <ul className="mt-4 space-y-2">
            {listed.map((game) => (
              <li key={game.title}>
                <a href={game.href} className="prose-link" {...newTab(game.href)}>
                  {game.title}
                </a>
                <span className="text-muted"> &mdash; {game.description}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mt-16">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-muted">
          {siteConfig.links.map((link) => (
            <li key={link.label}>
              <a href={link.href} className="prose-link" {...newTab(link.href)}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
