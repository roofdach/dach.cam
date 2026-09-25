import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import { siteConfig } from "@/config/site";
import { requestOrigin } from "@/lib/origin";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Read from the request rather than from config, because this site answers to
 * more than one domain and a link should preview as the domain it was sent as.
 * The cost is that pages render per request instead of being prerendered.
 */
export async function generateMetadata(): Promise<Metadata> {
  const origin = requestOrigin(await headers(), siteConfig.url);

  return {
    metadataBase: new URL(origin),
    title: siteConfig.name,
    description: siteConfig.description,
    openGraph: {
      title: siteConfig.name,
      description: siteConfig.description,
      type: "website",
      siteName: siteConfig.name,
      images: [{ url: "/og", width: 1200, height: 630, alt: siteConfig.description }],
    },
    twitter: {
      card: "summary_large_image",
      title: siteConfig.name,
      description: siteConfig.description,
      images: ["/og"],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#121210" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
