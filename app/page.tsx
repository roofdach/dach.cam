import { DynamicPresence } from "@/components/DynamicPresence";
import { siteConfig } from "@/config/site";
import { projects } from "@/data/projects";

/** Links off the site open in a new tab; `mailto:` and the like don't need one. */
function newTab(href: string) {
  return /^https?:/.test(href) ? { target: "_blank", rel: "noreferrer" } : {};
}

export default function Home() {
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

        <section aria-labelledby="projects" className="mt-16">
          <h2 id="projects" className="text-muted">
            projects
          </h2>
          <ul className="mt-4 space-y-2">
            {projects.map((project) => (
              <li key={project.title}>
                <a href={project.href} className="prose-link" {...newTab(project.href)}>
                  {project.title}
                </a>
                <span className="text-muted"> &mdash; {project.description}</span>
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
