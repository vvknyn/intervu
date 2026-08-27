/**
 * Company-directory search fallback for the MCP `search_companies` tool —
 * plain, normalized ILIKE substring matching against box `company_enrichment`
 * `data_type='company_profile'` payloads. No Meilisearch companies index was
 * found: a repo-wide grep for a companies index turned up nothing beyond
 * `JOBS_INDEX` (meilisearch.ts), and a live connectivity probe against the
 * box's Meili host from the box itself failed to connect — see Leg E's
 * report for the full trail. Substring-only, no fuzzy/embedding ranking, per
 * spec ("no fuzzy magic").
 */
import { num, str, strArray } from "./exhaust";
import type { Queryable } from "../pg/pool";

export interface CompanySearchHit {
    domain: string;
    name: string;
    industries: string[];
    hqCountry: string | null;
    /** Cheap "how many roles does this company have open" signal read
     *  straight off the profile payload — `null` when the payload doesn't
     *  carry one, never fabricated from a separate (expensive) jobs query. */
    openRolesHint: number | null;
}

/**
 * Trims + wraps free text as a safe ILIKE pattern. ILIKE's own wildcard
 * characters (`%`, `_`, `\`) are escaped first so a caller's search text can
 * never widen the match past a literal substring of what they typed.
 */
export function normalizeCompanySearchQuery(query: string): string {
    const escaped = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    return `%${escaped}%`;
}

interface CompanyProfileRow {
    company_domain: string;
    payload: Record<string, unknown>;
}

/**
 * Substring-matches `query` against a company's display name or its own
 * domain. `DISTINCT ON (company_domain) ... ORDER BY company_domain,
 * fetched_at DESC` keeps only the latest profile row per domain — the same
 * "latest wins" convention `fetchEnrichmentRows` (exhaust.ts) uses within one
 * domain, extended here across domains since this query scans the whole
 * table rather than one company's rows.
 */
export async function searchCompanies(pg: Queryable, query: string, limit: number): Promise<CompanySearchHit[]> {
    const pattern = normalizeCompanySearchQuery(query);
    const { rows } = await pg.query<CompanyProfileRow>(
        `SELECT DISTINCT ON (company_domain) company_domain, payload
         FROM company_enrichment
         WHERE data_type = 'company_profile'
           AND (payload->>'name' ILIKE $1 ESCAPE '\\' OR company_domain ILIKE $1 ESCAPE '\\')
         ORDER BY company_domain, fetched_at DESC
         LIMIT $2`,
        [pattern, limit],
    );
    return rows.map((r) => ({
        domain: r.company_domain,
        name: str(r.payload?.name) ?? r.company_domain,
        industries: strArray(r.payload?.industries),
        hqCountry: str(r.payload?.hq_country),
        openRolesHint: num(r.payload?.total_jobs),
    }));
}
