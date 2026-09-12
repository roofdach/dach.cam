import Link from "next/link";
import type { Project } from "@/data/projects";
import { ProjectPreview } from "./ProjectPreview";
import { Reveal } from "./Reveal";

interface ProjectCardProps {
  project: Project;
  index: number;
}

export function ProjectCard({ project, index }: ProjectCardProps) {
  const number = String(index + 1).padStart(2, "0");
  const flip = !project.featured && index % 2 === 0;

  return (
    <Reveal as="li" className="group">
      <article
        id={`work-${project.slug}`}
        aria-labelledby={`work-${project.slug}-title`}
        className={`grid scroll-mt-24 gap-6 lg:gap-x-10 ${project.featured ? "" : "lg:grid-cols-12 lg:items-start"}`}
      >
        <div
          className={
            project.featured
              ? "lg:max-w-[34rem]"
              : `lg:col-span-4 lg:sticky lg:top-10 ${flip ? "lg:order-2" : ""}`
          }
        >
          <div>
            <div className="label flex items-center gap-3">
              <span className="tnum">{number}</span>
              <span className="h-px w-6 bg-faint" aria-hidden />
              <span className="tnum text-faint">{project.year}</span>
            </div>
            <h3
              id={`work-${project.slug}-title`}
              className="mt-4 font-serif text-[2.25rem] leading-none tracking-tight sm:text-[2.5rem]"
            >
              <Link
                href={project.href}
                className="inline-flex items-baseline gap-3 text-ink transition-colors hover:text-accent focus-visible:text-accent"
              >
                {project.title}
                <span
                  aria-hidden
                  className="translate-y-[-0.15em] text-[0.32em] font-sans uppercase tracking-[0.12em] text-faint transition-all duration-300 ease-(--ease-out-quart) group-hover:translate-x-1 group-hover:text-accent"
                >
                  open
                </span>
              </Link>
            </h3>
          </div>

          <div className="mt-5 space-y-4">
            <p className="max-w-[34rem] text-[15px] leading-[1.7] text-ink-2">{project.description}</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted" aria-label="Built with">
              {project.stack.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            {project.note && (
              <p className="text-[13px] italic text-muted">
                <span aria-hidden>→ </span>
                {project.note}
              </p>
            )}
          </div>
        </div>

        <div className={project.featured ? "" : `lg:col-span-8 ${flip ? "lg:order-1" : ""}`}>
          <ProjectPreview kind={project.preview} title={project.title} />
        </div>
      </article>
    </Reveal>
  );
}
