/**
 * Company-directory search for the MCP `search_companies` tool — backed by
 * the SAME Meilisearch `jobs` index `get_company` itself resolves through
 * (`get-company.ts` → `searchJobs`), not a standalone companies index or a
 * Postgres scan of `company_enrichment`.
 *
 * Why: `company_enrichment` (~171k `company_profile` rows) is a superset of
 * the companies that actually have live/recent job postings. A live probe
 * proved `get_company` 404s for an enrichment-only domain with no jobs-index
 * presence — so searching the enrichment table directly returns hits the
 * sibling tool can't serve. Scoping the search to the jobs index instead
 * guarantees every hit is coherent with `get_company` by construction. An
 * ILIKE-on-`company_enrichment` path was tried first and rejected: no filter
 * narrows the ~171k rows before the ILIKE scan, so it blows the pool's 5s
 * statement_timeout regardless of query text — a Postgres index (pg_trgm)
 * would fix the timeout but not the coherence problem, so it was dropped in
 * favor of this redesign instead of layered on top of it.
 *
 * Two-step lookup, mirroring `get_company`'s own split between "what jobs
 * search knows" and "what box exhaust knows":
 *  1. Meili search scoped to the `company` field (`attributesToSearchOn`,
 *     the same per-query scoping `buildSearchBody`'s company-intent branch
 *     already uses in production) via the low-level `host`/`searchKey`/
 *     `meiliFetch` primitives `fetchJobSuggestions` uses — not
 *     `fetchJobSuggestions` itself, since that seam searches title+company
 *     and dedupes by title, both wrong for a company-only, domain-deduped
 *     lookup. Over-fetches (`limit * MEILI_OVERFETCH_MULTIPLIER`) so an
 *     in-memory dedupe by `company_domain` still yields `limit` companies.
 *  2. One batched Postgres read (`= ANY($1)`) against `company_enrichment`
 *     for the matched domains' extras (industries/hqCountry/openRolesHint)
 *     only — the same latest-wins `DISTINCT ON (company_domain) ... ORDER
 *     BY company_domain, fetched_at DESC` convention `getCompanyExhaust`
 *     uses elsewhere. `pg` is optional: when the exhaust box is unreachable,
 *     results still come back with real domains/names from Meili and honest
 *     nulls for the extras, rather than losing the whole search over a
 *     secondary enrichment source.
 *
 * A Meili failure is NOT caught here and does not fall back to the retired
 * SQL scan — it propagates to the MCP handler's generic isError wrapper.
 * Swallowing it to `[]` would read as "no such company" (a lying fallback);
 * an explicit tool error tells the caller the search itself failed.
 */
import { host, searchKey, meiliFetch, JOBS_INDEX } from "../jobs/meilisearch";
import { num, str, strArray } from "./exhaust";
import type { Queryable } from "../pg/pool";

export interface CompanySearchHit {
    domain: string;
    name: string;
    industries: string[];
    hqCountry: string | null;
    openRolesHint: number | null;
}

/** Trimmed, lowercased search text for the in-memory substring check against
 *  Meili hit `company`/`company_domain` fields below — no SQL involved, so
 *  (unlike the retired ILIKE-pattern version of this function) there's
 *  nothing to escape. */
export function normalizeCompanySearchQuery(query: string): string {
    return query.trim().toLowerCase();
}

/** Meili returns `limit * this` job hits so an in-memory dedupe by
 *  `company_domain` still has enough distinct companies to fill `limit`. */
const MEILI_OVERFETCH_MULTIPLIER = 10;

interface CompanyJobHit {
    company?: string | null;
    company_domain?: string | null;
}

async function searchCompanyJobHits(query: string, fetchLimit: number): Promise<CompanyJobHit[]> {
    const h = host();
    if (!h) return [];
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
        cache: "no-store",
        body: JSON.stringify({
            q: query,
            attributesToSearchOn: ["company"],
            attributesToRetrieve: ["company", "company_domain"],
            limit: fetchLimit,
        }),
    });
    if (!res.ok) throw new Error(`search_companies: Meilisearch returned ${res.status}`);
    const body = (await res.json()) as { hits?: CompanyJobHit[] };
    return body.hits ?? [];
}

interface CompanyProfileRow {
    company_domain: string;
    payload: Record<string, unknown>;
}

/** Batched extras lookup for an already-resolved set of domains — never the
 *  primary match path, so a null/unreachable `pg` just means bare Meili
 *  results (real domain/name, honest null extras) instead of losing the
 *  search entirely. */
async function fetchCompanyExtras(pg: Queryable | null, domains: string[]): Promise<Map<string, Record<string, unknown>>> {
    if (!pg || domains.length === 0) return new Map();
    const { rows } = await pg.query<CompanyProfileRow>(
        `SELECT DISTINCT ON (company_domain) company_domain, payload
         FROM company_enrichment
         WHERE data_type = 'company_profile'
           AND company_domain = ANY($1)
         ORDER BY company_domain, fetched_at DESC`,
        [domains],
    );
    return new Map(rows.map((r) => [r.company_domain, r.payload]));
}

export async function searchCompanies(pg: Queryable | null, query: string, limit: number): Promise<CompanySearchHit[]> {
    const needle = normalizeCompanySearchQuery(query);
    const hits = await searchCompanyJobHits(query, limit * MEILI_OVERFETCH_MULTIPLIER);

    const seen = new Set<string>();
    const matched: Array<{ domain: string; name: string }> = [];
    for (const hit of hits) {
        const domain = hit.company_domain?.trim().toLowerCase();
        const company = hit.company?.trim() ?? "";
        if (!domain || seen.has(domain)) continue;
        if (!company.toLowerCase().includes(needle) && !domain.includes(needle)) continue;
        seen.add(domain);
        matched.push({ domain, name: company });
        if (matched.length >= limit) break;
    }
    if (matched.length === 0) return [];

    const extras = await fetchCompanyExtras(pg, matched.map((m) => m.domain));
    return matched.map(({ domain, name }) => {
        const payload = extras.get(domain);
        return {
            domain,
            name: name || str(payload?.name) || domain,
            industries: strArray(payload?.industries),
            hqCountry: str(payload?.hq_country),
            openRolesHint: num(payload?.total_jobs),
        };
    });
}
