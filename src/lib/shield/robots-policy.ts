/**
 * Bot policy (P27 shield). Current policy (Vivek, 2026-08-02 — reverses the
 * original "block all AI crawlers" draft mid-build): search engines AND AI
 * answer-engine / GEO crawlers get the SAME treatment — allowed on the
 * public marketing surface for discovery/citation/inbound reasons. NO
 * named bot is blanket-blocked. The corpus itself is protected by rate
 * limits + the anonymous depth cap (lib/shield/rate-limit.ts,
 * lib/shield/depth-cap.ts), never by robots.txt — a `disallow` line is
 * crawl-budget/GEO hygiene, not a security boundary, and every named bot
 * (or an unnamed one ignoring robots.txt entirely) is still bound by those.
 * Single source of truth consumed by both `src/app/robots.ts` and its unit
 * tests.
 */

/** Mainstream search engines. */
export const SEARCH_ENGINE_BOTS = ["Googlebot", "Bingbot", "DuckDuckBot", "Applebot"] as const;

/** AI answer-engine / GEO crawlers — treated identically to search engines
 *  (see policy note above). Kept as its own named list (rather than merged
 *  into `SEARCH_ENGINE_BOTS`) because this is the exact axis Vivek already
 *  reversed once; a future re-split only needs to change this array. */
export const AI_ANSWER_ENGINE_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Bytespider",
  "meta-externalagent",
] as const;

/** Authed/API/private surfaces — never worth crawling regardless of bot. */
export const PRIVATE_PATHS = ["/api/", "/admin", "/settings", "/account", "/reset-password"];

/**
 * Query-parameterized search-result permutations of the job-search surface
 * (the root `/` — see `lib/jobs/url-state.ts`'s `serializeJobsUrl`: `q`,
 * facet filters, `sort`, etc. all live on `/?...`, never a distinct path;
 * pagination itself has no URL at all, since infinite-scroll `offset` is
 * client-only state — see `loadMore` in `src/app/page.tsx`). Disallowing
 * `/?` keeps crawl budget on the canonical `/` and named marketing pages
 * instead of the unbounded space of query-string combinations. In standard
 * robots.txt precedence the longer, more specific rule wins, so this
 * `disallow: "/?"` overrides the shorter `allow: "/"` for exactly the
 * `/?...` case while leaving bare `/` (and every other allowed path)
 * untouched.
 */
export const DEEP_SEARCH_DISALLOW_PATTERN = "/?";

export interface RobotsRule {
  userAgent: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
}

/**
 * Pure builder for the `robots.ts` rules array. Any crawler not named below
 * still gets the general `"*"` rule (marketing surface allowed, private/API
 * and query-parameterized search results not) — a new search engine or AI
 * crawler works by default with no code change needed.
 */
export function buildRobotsRules(): RobotsRule[] {
  const crawlableBots: string[] = [...SEARCH_ENGINE_BOTS, ...AI_ANSWER_ENGINE_BOTS];
  return [
    { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS, DEEP_SEARCH_DISALLOW_PATTERN] },
    { userAgent: crawlableBots, allow: "/", disallow: ["/api/", DEEP_SEARCH_DISALLOW_PATTERN] },
  ];
}
