import type { Metadata } from "next";
import { CookieClicker } from "@/components/cookie/CookieClicker";

const title = "cookie";
const description = "a cookie clicker. click the cookie, buy buildings, catch the golden ones.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: description }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og"] },
};

export default function CookiePage() {
  return <CookieClicker />;
}
