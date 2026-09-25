/**
 * Which address this request actually came in on. Behind a proxy the original
 * host is in `x-forwarded-host`, and `host` is whatever the proxy dialled.
 */
export function requestOrigin(headers: Headers, fallback: string): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host || !/^[\w.-]+(:\d+)?$/.test(host)) return fallback;
  const protocol = headers.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${protocol.split(",")[0]}://${host}`;
}

/**
 * The hostname as a reader would write it: no port, no `www.`, and nothing that
 * doesn't look like a domain. Anything else gets the fallback.
 */
export function labelForHost(host: string | null, fallback: string): string {
  const cleaned = (host ?? "")
    .split(":")[0]
    .replace(/^www\./i, "")
    .toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned) ? cleaned : fallback;
}
