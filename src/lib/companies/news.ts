/**
 * Subspace Company News API client (SERVER-ONLY).
 *
 * Read-only client for `GET /companies/{domain}/news`. Same auth/base-URL
 * conventions as `src/lib/jobs/subspaceJobs.ts` (x-api-key header,
 * SUBSPACE_API_BASE_URL with a default, SUBSPACE_API_KEY from the server
 * environment only).
 *
 * Unlike the jobs client, this call sits on the company page's render path
 * and the endpoint may not exist yet in production, so it FAILS SOFT: any
 * non-2xx status, network error, timeout, or malformed body resolves to an
 * empty array rather than throwing. A missing news card is correct; a
 * broken company page is not.
 */
import { hasSubspaceApiKey } from "@/lib/jobs/subspaceJobs";
import type { CompanyNewsArticle } from "./types";

const DEFAULT_BASE_URL = "https://www.thesubspace.io/api/v1";
const FETCH_TIMEOUT_MS = 2500;

function baseUrl(): string {
  return (process.env.SUBSPACE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

interface CompanyNewsEnvelope {
  data?: {
    domain?: string;
    articles?: CompanyNewsArticle[];
  };
}

/**
 * An article we are willing to put on a page: it has a headline, and a link
 * that actually goes somewhere on the web.
 *
 * The scheme check is not paranoia about our own API — it's that this value
 * lands in an `<a href>`, so anything that can reach here can render a link.
 * Restricting to http/https means a malformed or hostile row (`javascript:`,
 * `data:`) can never become a clickable vector, regardless of what upstream
 * does later.
 */
function isRenderableArticle(a: CompanyNewsArticle): boolean {
  if (typeof a?.title !== "string" || a.title.trim() === "") return false;
  if (typeof a?.url !== "string") return false;
  try {
    const { protocol } = new URL(a.url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The small, closed set of HTML entities RSS/Atom feed serializers leave in
 * plain-text fields — never a full HTML-entity vocabulary, because `title`/
 * `summary` are prose, not markup, so nothing here needs to understand tags.
 * Numeric entities (`&#39;`, `&#x27;`) are fully general via `fromCodePoint`;
 * named entities are the handful actually seen in feed text.
 */
const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  mdash: "—", ndash: "–", hellip: "…",
};

/** Pure: decode HTML entities in one string, or return it unchanged when
 *  there's nothing to decode. Exported so the decode rule itself — not just
 *  its wiring into `shapeNewsArticle` — is directly unit-testable. */
export function decodeHtmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, ent: string) => {
    if (ent[0] === "#") {
      const codePoint = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_HTML_ENTITIES[ent.toLowerCase()] ?? match;
  });
}

/**
 * `CompanyNewsArticle` as fetched, with entity-decoded display text. The one
 * place feed markup crosses into product copy — `title`/`summary` render
 * directly in `CompanyIntelligenceGrid`'s news card — so decoding happens
 * once here rather than at each render site.
 */
export function shapeNewsArticle(a: CompanyNewsArticle): CompanyNewsArticle {
  return {
    ...a,
    title: decodeHtmlEntities(a.title),
    summary: a.summary ? decodeHtmlEntities(a.summary) : a.summary,
  };
}

/** Collapses whitespace and case so two feeds' punctuation/formatting
 *  variants of the same headline compare equal. */
function normalizedTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Same story, syndicated to more than one outlet, is not two stories. RSS
 * aggregation genuinely republishes one headline across several publishers
 * (and sometimes the same publisher twice), so the news card would otherwise
 * show a duplicate row for it. Keeps the FIRST occurrence — articles arrive
 * newest-first from the API, so "first" is "most recent" — and is pure/order-
 * preserving so it composes with the existing filter/map pipeline.
 */
export function dedupeNewsArticles(articles: CompanyNewsArticle[]): CompanyNewsArticle[] {
  const seen = new Set<string>();
  return articles.filter((a) => {
    const key = normalizedTitle(a.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Fetches recent news for a company domain. Fails soft to `[]` on any error. */
export async function fetchCompanyNews(domain: string): Promise<CompanyNewsArticle[]> {
  if (!hasSubspaceApiKey()) return [];

  const url = new URL(`${baseUrl()}/companies/${encodeURIComponent(domain)}/news`);
  url.searchParams.set("limit", "5");

  try {
    const res = await fetch(url.toString(), {
      headers: { "x-api-key": process.env.SUBSPACE_API_KEY as string, accept: "application/json" },
      // News moves on the order of days, not requests-per-render — ISR-cache
      // it (like get-job.ts's job-by-id lookup) so repeat views of the same
      // company within the hour cost nothing against the API's rate limit.
      // AbortSignal still aborts a hung request even under Next's fetch
      // cache: the signal governs the underlying request, the cache option
      // governs storage — they compose (see get-job.ts for the same pattern
      // minus the signal).
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    // Includes 404 (endpoint not deployed yet) — fail soft, not an error state.
    if (!res.ok) return [];

    const body = (await res.json()) as CompanyNewsEnvelope;
    if (!Array.isArray(body?.data?.articles)) return [];
    // Validate at the seam, not at each render site. This is the one place
    // cross-repo data enters, so dropping malformed rows here protects every
    // future consumer — a component-level guard would have to be rewritten
    // for each new one. An article with no headline or no link is not a
    // publishable article: rendering it would put an empty card, or a link
    // to nowhere, on a page whose whole point is that it only shows what it
    // can source.
    return dedupeNewsArticles(body.data.articles.filter(isRenderableArticle).map(shapeNewsArticle));
  } catch {
    // Network error, timeout/abort, or malformed JSON — never break the page.
    return [];
  }
}
