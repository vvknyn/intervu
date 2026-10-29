/**
 * Bulk-scrape signature check for API-shaped paths (P27 shield). Deliberately
 * narrow, per policy: an empty/absent User-Agent on a non-GET request under
 * `/api/` is a signature no real *browser-facing* client produces — not a
 * browser, not a search-engine crawler, not the uptime probe's plain `curl` GET
 * against https://intervu.cc/trends (a page route, and a GET, so it never
 * reaches this check at all) — but a scripted bulk client easily does. No
 * UA-content sniffing, no fingerprinting, no CAPTCHA: false positives here
 * block real users, which is worse than a slow leak.
 *
 * The heuristic only speaks for clients that fetch FROM us. Third-party servers
 * that call INTO us are excluded below — see `isThirdPartyCallbackPath`.
 */

/** Exact segment match or anything nested beneath it — `/apitest` is neither. */
function isAtOrBeneath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isApiShapedPath(pathname: string): boolean {
  return isAtOrBeneath(pathname, "/api");
}

/**
 * Inbound callbacks from other companies' infrastructure. Two properties make
 * the User-Agent heuristic meaningless here, and both hold for every provider,
 * not just the one that caught us:
 *
 *  - They authenticate the request body cryptographically (Resend signs with
 *    Standard Webhooks HMAC-SHA256), so a forged callback is rejected by the
 *    route on its own merits. The shield adds no security it doesn't already have.
 *  - Their User-Agent is chosen by infrastructure we don't control and can't
 *    negotiate with. Resend sends none, so the shield 403'd every bounce and
 *    complaint for five days until Resend disabled the endpoint (Aug 18 2026).
 *
 * Keyed on the route convention rather than a provider list so the next webhook
 * we add is covered by construction.
 */
export function isThirdPartyCallbackPath(pathname: string): boolean {
  return isAtOrBeneath(pathname, "/api/webhooks");
}

/**
 * The agent surface: `/api/mcp` and the two OAuth endpoints under
 * `/api/oauth`. Hosted connectors (claude.ai, ChatGPT, Gemini) call these from
 * the provider's own servers, so the User-Agent — or its absence — is the
 * provider's choice, same as the webhook senders above. Nothing is lost by
 * leaving them out: `/api/mcp` answers 401 without a valid bearer, and
 * `/api/oauth/register` and `/api/oauth/token` are rate-limited per caller IP
 * before any work (src/app/api/oauth/*).
 */
export function isAgentServerPath(pathname: string): boolean {
  return isAtOrBeneath(pathname, "/api/mcp") || isAtOrBeneath(pathname, "/api/oauth");
}

export interface SuspiciousRequestInput {
  pathname: string;
  method: string;
  userAgent: string | null | undefined;
}

export function shouldBlockSuspiciousRequest(input: SuspiciousRequestInput): boolean {
  if (!isApiShapedPath(input.pathname)) return false;
  if (isThirdPartyCallbackPath(input.pathname)) return false;
  if (isAgentServerPath(input.pathname)) return false;
  if (input.method === "GET" || input.method === "HEAD") return false;
  return (input.userAgent ?? "").trim().length === 0;
}
