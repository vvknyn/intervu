import { headers } from "next/headers";

/**
 * Client IP resolution behind Caddy (deploy/Caddyfile — no `trusted_proxies`
 * block configured). Caddy's default `reverse_proxy` behavior IGNORES any
 * X-Forwarded-For value a client sends and sets the header itself from the
 * actual TCP peer it saw
 * (https://caddyserver.com/docs/caddyfile/directives/reverse_proxy —
 * "by default, the proxy will ignore [incoming XFF] values... to prevent
 * spoofing"). So in THIS deployment the header reaching Next.js is Caddy's
 * own unspoofable determination, normally a single IP.
 *
 * We still take the LEFTMOST comma-separated entry rather than assuming
 * there's only one, so this keeps working unchanged if a CDN or load
 * balancer is ever added in front of Caddy with `trusted_proxies`
 * configured (standard `client, proxy1, proxy2…` convention — the original
 * client is always leftmost, each hop appends itself to the right).
 *
 * Load-bearing assumption to revisit if the deploy topology changes: Caddy
 * must remain the ONLY reverse proxy between the internet and this
 * container. If another trusted hop is added without also configuring
 * Caddy's `trusted_proxies`, this stops being the trustworthy value.
 */
export function resolveClientIp(xForwardedFor: string | null | undefined): string {
  if (!xForwardedFor) return "unknown";
  const first = xForwardedFor.split(",")[0]?.trim();
  return first || "unknown";
}

/** Thin I/O wrapper: `resolveClientIp` wired to the request's real headers. */
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  return resolveClientIp(headersList.get("x-forwarded-for"));
}
