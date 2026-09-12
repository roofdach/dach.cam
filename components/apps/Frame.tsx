import Link from "next/link";
import { projects } from "@/data/projects";
import { siteConfig } from "@/config/site";

interface FrameProps {
  slug: string;
  children: React.ReactNode;
  /** Shown under the title. One line, lowercase, no marketing. */
  tagline: string;
  /** Optional notes rendered in small print under the app itself. */
  notes?: React.ReactNode;
  /** Let the app run edge to edge instead of sitting in the reading column. */
  wide?: boolean;
}

/**
 * Shared chrome for the four apps. Deliberately thin: a way back to the site,
 * the project's own name, and a way across to the others.
 */
export function Frame({ slug, children, tagline, notes, wide = false }: FrameProps) {
  const project = projects.find((p) => p.slug === slug)!;
  const others = projects.filter((p) => p.slug !== slug);

  return (
    <div className={`mx-auto flex w-full flex-1 flex-col px-5 pt-7 sm:px-8 ${wide ? "max-w-[96rem]" : "max-w-[72rem]"}`}>
      <header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
          <Link href="/" className="text-muted transition-colors hover:text-ink">
            {siteConfig.name}
          </Link>
          <span className="text-faint" aria-hidden>
            /
          </span>
          <span className="text-ink">{project.title}</span>
          <span className="label ml-auto tnum">{project.year}</span>
        </div>

        <div className="mt-7 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-5">
          <h1 className="font-serif text-[2.5rem] leading-none tracking-tight text-ink sm:text-[3rem]">
            {project.title}
          </h1>
          <p className="max-w-[30rem] text-[14px] leading-relaxed text-muted">{tagline}</p>
        </div>
      </header>

      <main className="flex-1 pt-8">{children}</main>

      {notes && <div className="mt-10 max-w-[38rem] space-y-3 text-[13px] leading-relaxed text-muted">{notes}</div>}

      <footer className="mt-16 border-t border-line py-6 sm:mt-24">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3 text-[13px]">
          <span className="label">elsewhere</span>
          {others.map((p) => (
            <Link key={p.slug} href={p.href} className="text-ink-2 transition-colors hover:text-accent">
              {p.title}
            </Link>
          ))}
          <Link href="/#work" className="ml-auto text-muted transition-colors hover:text-ink">
            back to the site
          </Link>
        </div>
      </footer>
    </div>
  );
}
