import { headers } from "next/headers";

/**
 * The ONE place in this app that decides what a client's IP is. Every
 * chokepoint (shield rate limiters, the agent OAuth routes) resolves
 * through here — a second resolver is how `agent/rate-limit.ts` and this
 * file used to quietly disagree (fixed 2026-08-16, see git history).
 *
 * Deploy topology: Cloudflare (DNS-proxied in front of intervuhq.com) →
 * Caddy → this container. `CF-Connecting-IP` wins whenever present —
 * Cloudflare terminates the internet-facing connection and sets that header
 * itself from the real TCP peer it saw, overwriting anything a client sent;
 * it cannot be forged by a request that actually passed through Cloudflare's
 * edge.
 *
 * X-Forwarded-For is the fallback, for traffic that reaches Caddy without
 * going through Cloudflare (topology not yet cut over, or a direct hit on
 * the origin). Caddy is not configured to preserve an inbound XFF — verified
 * empirically 2026-08-16: 100 requests to /api/jobs/suggest, each carrying a
 * different forged XFF, still tripped the 90/60s limit at exactly 90
 * admitted / 10 denied, proof only Caddy's own single value reached the app,
 * never the forged one. (No in-repo Caddyfile documents this for
 * intervuhq.com — the live vhost exists only in Caddy's in-memory config on
 * the box — so the experiment is the evidence, not a config file.) So the
 * LEFTMOST (and, today, only) entry is safe to trust here, not a
 * caller-controlled hop.
 *
 * Load-bearing assumptions to revisit if the topology changes again: (1)
 * Cloudflare must remain the outermost edge for CF-Connecting-IP to mean
 * anything — a request that never touched Cloudflare could set that header
 * itself; (2) Caddy must remain the ONLY reverse proxy between Cloudflare
 * and this container for the XFF fallback to stay trustworthy; (3) THIS
 * FUNCTION CANNOT CLOSE the direct-to-origin hole by itself — the origin IP
 * (194.163.147.154) is publicly reachable, so a request sent straight to it,
 * bypassing Cloudflare, can set CF-Connecting-IP to anything and this
 * resolver will believe it, letting a rotating header walk straight past
 * every per-IP limit. Closing that requires the edge (Caddy dropping
 * CF-Connecting-IP from non-Cloudflare peers, or firewalling the origin to
 * Cloudflare's IP ranges), not app code — not implemented here.
 */
export function resolveClientIp(
  xForwardedFor: string | null | undefined,
  cfConnectingIp?: string | null | undefined,
): string {
  const cf = cfConnectingIp?.trim();
  if (cf) return cf;
  if (!xForwardedFor) return "unknown";
  const first = xForwardedFor.split(",")[0]?.trim();
  return first || "unknown";
}

/** Thin I/O wrapper: `resolveClientIp` wired to the request's real headers,
 *  for Server Components / Server Actions (reads `next/headers()`). */
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  return resolveClientIp(headersList.get("x-forwarded-for"), headersList.get("cf-connecting-ip"));
}

/** Same resolution, for callers holding a raw `Headers` object (route
 *  handlers with a `Request`, rather than going through `next/headers()`) —
 *  the seam `agent/rate-limit.ts`'s OAuth routes use instead of keeping
 *  their own resolver. */
export function resolveClientIpFromHeaders(h: Headers): string {
  return resolveClientIp(h.get("x-forwarded-for"), h.get("cf-connecting-ip"));
}
