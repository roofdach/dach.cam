import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";
import { labelForHost, PREVIEW_HEIGHT, PREVIEW_WIDTH, previewSvg } from "@/lib/field/preview-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The link preview. It is a frame of `field` with the domain someone actually
 * typed stencilled into it, so the same site shared under a different name
 * shows that name back.
 */
export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const label = labelForHost(host, siteConfig.url.replace(/^https?:\/\//, ""));
  const svg = previewSvg(label);
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} alt="" />
      </div>
    ),
    { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
  );
}
