import { siteConfig } from "@/config/site";

export function Footer() {
  return (
    <footer className="mx-auto mt-32 w-full max-w-[68rem] px-6 pb-10 sm:mt-40 sm:px-8">
      <div className="hairline flex flex-wrap items-baseline justify-between gap-3 pt-6 text-[13px] text-muted">
        <p>
          &copy; {new Date().getFullYear()} {siteConfig.name}
        </p>
        <p className="font-mono text-[11.5px]">made in {siteConfig.location.toLowerCase()}, served everywhere</p>
      </div>
    </footer>
  );
}
