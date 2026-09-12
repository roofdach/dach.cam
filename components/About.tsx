import { siteConfig } from "@/config/site";
import { Reveal } from "./Reveal";
import { Skills } from "./Skills";

export function About() {
  return (
    <section
      id="about"
      aria-labelledby="about-heading"
      className="mx-auto mt-32 w-full max-w-[68rem] px-6 sm:mt-44 sm:px-8"
    >
      <Reveal className="hairline pt-6">
        <h2 id="about-heading" className="label">
          about
        </h2>
      </Reveal>

      <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:gap-10">
        <Reveal className="space-y-5 text-[16px] leading-[1.75] text-ink-2 lg:col-span-7">
          <p>
            i&rsquo;m {siteConfig.age} and i live in {siteConfig.location.toLowerCase()}, which means a lot of
            rain and a lot of time indoors with a laptop. i started out changing colours in other people&rsquo;s
            css and at some point that turned into building whole things.
          </p>
          <p>
            i learn by making. i&rsquo;ll pick something i don&rsquo;t know how to do yet, build a slightly
            rough version, and then keep going back until the rough edges are gone. most of what&rsquo;s on this
            page started that way.
          </p>
          <p>
            the details are the part i care about most: the timing of a transition, how a layout holds up at
            an awkward width, whether the empty state was actually designed or just left over. small things,
            but they&rsquo;re what people feel even when they can&rsquo;t name them.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="lg:col-span-4 lg:col-start-9">
          <Skills />
        </Reveal>
      </div>
    </section>
  );
}
