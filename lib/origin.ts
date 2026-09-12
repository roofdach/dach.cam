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
