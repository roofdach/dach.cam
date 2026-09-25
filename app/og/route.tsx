import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";
import { labelForHost } from "@/lib/origin";

export const dynamic = "force-dynamic";

/**
 * The link preview: the domain someone actually typed, in the page's own
 * colours, so the same site shared under a different name shows that name back.
 */
export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const label = labelForHost(host, siteConfig.url.replace(/^https?:\/\//, ""));

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          height: "100%",
          padding: "0 96px",
          background: "#121210",
          color: "#e8e5dd",
          fontSize: 96,
          letterSpacing: "-0.03em",
        }}
      >
        {label}
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
