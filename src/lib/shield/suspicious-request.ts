/**
 * Bulk-scrape signature check for API-shaped paths (P27 shield). Deliberately
 * narrow, per policy: an empty/absent User-Agent on a non-GET request under
 * `/api/` is a signature no real client produces — not a browser, not a
 * search-engine crawler, not the uptime probe's plain `curl` GET against
 * https://intervu.cc/trends (a page route, and a GET, so it never reaches
 * this check at all) — but a scripted bulk client easily does. No UA-content
 * sniffing, no fingerprinting, no CAPTCHA: false positives here block real
 * users, which is worse than a slow leak.
 */
export function isApiShapedPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export interface SuspiciousRequestInput {
  pathname: string;
  method: string;
  userAgent: string | null | undefined;
}

export function shouldBlockSuspiciousRequest(input: SuspiciousRequestInput): boolean {
  if (!isApiShapedPath(input.pathname)) return false;
  if (input.method === "GET" || input.method === "HEAD") return false;
  return (input.userAgent ?? "").trim().length === 0;
}
