import { siteConfig } from "@/config/site";
import { DynamicPresence } from "./DynamicPresence";
import { Reveal } from "./Reveal";

export function Intro() {
  return (
    <section
      id="top"
      aria-label="Introduction"
      className="mx-auto w-full max-w-[68rem] px-6 pt-20 pb-24 sm:px-8 sm:pt-28 sm:pb-32"
    >
      <div className="max-w-[36rem] space-y-6 text-[17px] leading-[1.7] text-ink sm:text-[18px]">
        <Reveal as="p" immediate delay={0.05}>
          hey, i&rsquo;m {siteConfig.name}. i&rsquo;m {siteConfig.age}, i live in{" "}
          {siteConfig.location.toLowerCase()}, and i mostly build for the web. lately that means a lot of
          typescript, a lot of react, and a lot of tailwind
        </Reveal>

        <Reveal as="p" immediate delay={0.25} className="text-ink-2">
          most of what i know i learned by building something slightly too ambitious and then asking ai why it broke. that&rsquo;s still the plan.
        </Reveal>

        <Reveal immediate delay={0.35}>
          <DynamicPresence className="text-ink-2" />
        </Reveal>
      </div>
    </section>
  );
}
