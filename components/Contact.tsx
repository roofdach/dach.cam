import { siteConfig } from "@/config/site";
import { ArrowIcon } from "./Icons";
import { Reveal } from "./Reveal";

export function Contact() {
  const links: { label: string; value: string; href: string }[] = [];
  if (siteConfig.email) links.push({ label: "email", value: siteConfig.email, href: `mailto:${siteConfig.email}` });
  if (siteConfig.github) {
    links.push({
      label: "github",
      value: siteConfig.github.replace(/^https?:\/\/(www\.)?/, ""),
      href: siteConfig.github,
    });
  }

  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="mx-auto mt-32 w-full max-w-[68rem] px-6 sm:mt-44 sm:px-8"
    >
      <Reveal className="hairline pt-6">
        <h2 id="contact-heading" className="label">
          contact
        </h2>
      </Reveal>

      <Reveal className="mt-10 grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="font-serif text-[2.25rem] leading-[1.05] tracking-tight text-ink sm:text-[3rem]">
            have something worth building?
          </p>
          <p className="mt-5 max-w-[30rem] text-[16px] leading-[1.7] text-ink-2">
            i&rsquo;m always up for interesting frontend work, odd little experiments, or just talking about
            interfaces. the fastest way to reach me is below.
          </p>
        </div>

        <ul className="space-y-3 text-[15px] lg:col-span-4 lg:col-start-9">
          {links.map((l) => (
            <li key={l.label} className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
              <span className="label">{l.label}</span>
              <a
                href={l.href}
                className="prose-link inline-flex items-center gap-1 text-ink"
                target={l.href.startsWith("mailto:") ? undefined : "_blank"}
                rel={l.href.startsWith("mailto:") ? undefined : "noreferrer"}
              >
                {l.value}
                <ArrowIcon width={13} height={13} className="text-muted" />
              </a>
            </li>
          ))}
          {siteConfig.discordHandle && (
            <li className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
              <span className="label">discord</span>
              <span className="text-ink">{siteConfig.discordHandle}</span>
            </li>
          )}
          {links.length === 0 && !siteConfig.discordHandle && (
            <li className="text-[13px] text-muted">links are coming, this bit of config is still empty.</li>
          )}
        </ul>
      </Reveal>
    </section>
  );
}
