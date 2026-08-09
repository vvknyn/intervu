import type { MetadataRoute } from "next";
import { buildRobotsRules } from "@/lib/shield/robots-policy";
import { SITE_URL } from "@/lib/seo/constants";

/**
 * /robots.txt — policy (P27 shield, updated 2026-08-02): search engines AND
 * AI answer-engine/GEO crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.)
 * index the public marketing surface — no named bot is blanket-blocked.
 * Everyone (named or not) is disallowed on `/api/`, admin/authed surfaces,
 * and query-parameterized search results (`/?...` — the unbounded space of
 * job-search permutations). The corpus itself is protected by rate limits
 * and the anonymous depth cap (lib/shield/rate-limit.ts,
 * lib/shield/depth-cap.ts), never by robots.txt. See
 * `lib/shield/robots-policy.ts` for the rule contents and the policy's
 * history.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: buildRobotsRules(),
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
