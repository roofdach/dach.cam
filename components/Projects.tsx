import { projects } from "@/data/projects";
import { ProjectCard } from "./ProjectCard";
import { ProjectNav } from "./ProjectNav";
import { Reveal } from "./Reveal";

export function Projects() {
  return (
    <section id="work" aria-labelledby="work-heading" className="mx-auto w-full max-w-[68rem] px-6 sm:px-8">
      <Reveal className="hairline flex items-baseline justify-between pt-6">
        <h2 id="work-heading" className="label">
          selected work
        </h2>
        <p className="text-[13px] text-muted">random projects made for this site</p>
      </Reveal>

      <ProjectNav />

      <ol id="work-list" className="mt-14 space-y-28 sm:mt-20 sm:space-y-36">
        {projects.map((project, i) => (
          <ProjectCard key={project.slug} project={project} index={i} />
        ))}
      </ol>
    </section>
  );
}
