import { siteConfig } from "@/config/site";
import { GitHubIcon, InstagramIcon, MailIcon, RssIcon, XIcon } from "./Icons";
import { Reveal } from "./Reveal";

const nav = [
  { href: "#work", label: "work" },
  { href: "#about", label: "about" },
  { href: "#contact", label: "contact" },
];

export function Header() {
  const socials = [
    { href: siteConfig.github, label: "GitHub", Icon: GitHubIcon },
    { href: siteConfig.instagram, label: "Instagram", Icon: InstagramIcon },
    { href: siteConfig.x, label: "X", Icon: XIcon },
    { href: siteConfig.rss, label: "RSS", Icon: RssIcon },
    { href: siteConfig.email ? `mailto:${siteConfig.email}` : "", label: "Email", Icon: MailIcon },
  ].filter((s) => s.href);

  return (
    <Reveal as="header" immediate className="mx-auto w-full max-w-[68rem] px-6 pt-8 sm:px-8 sm:pt-10">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-5">
        <a
          href="#top"
          className="order-1 text-[15px] font-medium tracking-tight text-ink transition-colors hover:text-accent"
        >
          {siteConfig.name}
        </a>

        <nav aria-label="Primary" className={`order-3 basis-full sm:order-2 sm:basis-auto ${socials.length === 0 ? "sm:ml-auto" : ""}`}>
          <ul className="flex items-center gap-5 text-[14px] text-muted sm:gap-6">
            {nav.map((item) => (
              <li key={item.href}>
                <a href={item.href} className="transition-colors hover:text-ink">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {socials.length > 0 ? (
          <ul className="order-2 -mr-2 flex items-center gap-1 sm:order-3" aria-label="Elsewhere">
            {socials.map(({ href, label, Icon }) => {
              const external = !href.startsWith("mailto:");
              return (
                <li key={label}>
                  <a
                    href={href}
                    aria-label={label}
                    title={label}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noreferrer" : undefined}
                    className="inline-flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
                  >
                    <Icon />
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Reveal>
  );
}
