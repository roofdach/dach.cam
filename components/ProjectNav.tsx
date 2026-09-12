"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { projects } from "@/data/projects";

/**
 * A rail that appears while the work section is on screen and names whichever
 * project is nearest the middle of the viewport. It sits in the margin beside
 * the reading column, so it is only shown where there is actually room for it.
 */
export function ProjectNav() {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(projects[0]?.slug ?? "");
  const ratios = useRef(new Map<string, number>());

  useEffect(() => {
    // The list itself, not the section: the section's heading is already on
    // screen when the page loads, and the rail has no business being there yet.
    const list = document.getElementById("work-list");
    if (!list) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      // A thin band across the middle of the viewport. The rail appears once a
      // project is actually the thing you are looking at, and leaves when the
      // last one has gone past.
      rootMargin: "-45% 0px -45% 0px",
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const articles = projects
      .map((project) => document.getElementById(`work-${project.slug}`))
      .filter((el): el is HTMLElement => el !== null);
    if (!articles.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.current.set(entry.target.id.replace("work-", ""), entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        let best = "";
        let bestRatio = 0;
        for (const [slug, ratio] of ratios.current) {
          if (ratio > bestRatio) {
            best = slug;
            bestRatio = ratio;
          }
        }
        if (best) setActive(best);
      },
      { threshold: [0, 0.15, 0.35, 0.6, 0.85, 1] },
    );

    articles.forEach((article) => observer.observe(article));
    return () => observer.disconnect();
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.nav
          aria-label="Projects"
          initial={reduce ? { opacity: 1 } : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -8 }}
          transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
          className="fixed top-1/2 z-30 hidden -translate-y-1/2 xl:block"
          style={{ left: "max(0.5rem, calc(50% - 34rem - 6rem))" }}
        >
          <ol className="space-y-1">
            {projects.map((project, i) => {
              const on = project.slug === active;
              return (
                <li key={project.slug}>
                  <a
                    href={`#work-${project.slug}`}
                    aria-current={on ? "true" : undefined}
                    className={`group flex items-center gap-2 rounded-md py-1 pl-1 pr-2 text-[12px] transition-colors ${
                      on ? "text-ink" : "text-faint hover:text-muted"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`h-px transition-all duration-300 ease-(--ease-out-quart) ${
                        on ? "w-4 bg-accent" : "w-2 bg-faint group-hover:w-3 group-hover:bg-muted"
                      }`}
                    />
                    <span className="font-mono text-[10.5px] tnum">{String(i + 1).padStart(2, "0")}</span>
                    <span>{project.title}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}
