/**
 * MCP tool implementations for the company "Hiring Record" surface —
 * get_company, get_company_timeline, search_companies (Leg E). Each reads
 * through the SAME chokepoint `/co/[slug]` itself renders through
 * (`getCompanyPageData`/`getCompanyExhaust`), injected via `ToolDeps` like
 * every other tool in tools.ts — no direct Postgres/Firestore/Meili access
 * here.
 */
import { decodeSlug, domainToSlug, slugToDomain } from "../boards/slug";
import { CHANGE_HISTORY_LIMIT, type ChangeEventRow } from "../companies/exhaust";
import type { CompanyPageData } from "../companies/types";
import type { CompanySearchHit } from "../companies/company-search";
import { AGENT } from "./config";
import { toSearchHit, type SearchHit, type ToolDeps } from "./tools";

/**
 * Resolves an MCP caller's free-form `slug_or_domain` to a domain.
 * `getCompanyPageData` only understands the `--`-encoded URL slug form
 * (`slugToDomain`/`decodeSlug`, `boards/slug.ts`) — an MCP caller has no
 * reason to know that encoding, so a bare domain (e.g. "stripe.com") is
 * accepted too via a minimal shape check (contains a dot, no whitespace).
 * Not an existence check — `getCompanyPageData`/`getCompanyExhaust` are the
 * real "does this company have a real record" answer.
 */
export function resolveCompanyDomain(input: string): string | null {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    const viaSlug = slugToDomain(trimmed) ?? decodeSlug(trimmed);
    if (viaSlug) return viaSlug;
    return trimmed.includes(".") && !/\s/.test(trimmed) ? trimmed : null;
}

export interface CompanyOut extends Omit<CompanyPageData, "jobs"> {
    /** `CompanyPageData.jobs` re-mapped through the SAME wire allowlist
     *  search_jobs/get_job use (`toSearchHit`) — a raw `PublicJob[]` spread
     *  here would defeat that allowlist for this one surface. */
    jobs: SearchHit[];
}

export async function toolGetCompany(
    deps: ToolDeps,
    input: { slug_or_domain: string },
): Promise<CompanyOut | { error: string }> {
    const domain = resolveCompanyDomain(input.slug_or_domain);
    if (!domain) return { error: "invalid company identifier" };
    let page: CompanyPageData | null;
    try {
        page = await deps.getCompanyPageData(domainToSlug(domain));
    } catch {
        // getCompanyPageData throws when its own jobs search is unavailable
        // (see get-company.ts) — a real backend outage, never a "no such
        // company," so it gets the same distinct outcome `isBackendDown`
        // gives search_jobs/get_job.
        return { error: "search backend unavailable" };
    }
    if (!page) return { error: "company not found" };
    return { ...page, jobs: page.jobs.map((job) => toSearchHit(job)) };
}

export interface CompanyTimelineOut {
    events: ChangeEventRow[];
}

export async function toolGetCompanyTimeline(
    deps: ToolDeps,
    input: { slug_or_domain: string; limit?: number },
): Promise<CompanyTimelineOut | { error: string }> {
    const domain = resolveCompanyDomain(input.slug_or_domain);
    if (!domain) return { error: "invalid company identifier" };
    const exhaust = await deps.getCompanyExhaust(domain);
    // `null` here means the exhaust connection itself is unavailable
    // (EXHAUST_PG_URL unset/unreachable) — a real error. A real company with
    // zero PUBLISHED events still gets a `changeHistory` section (empty
    // `data`), which is an honest empty timeline, not an error — same
    // distinction `toolGetResumeVariant` draws for "no pursuit yet."
    if (!exhaust) return { error: "exhaust data unavailable" };
    const events = exhaust.changeHistory?.data ?? [];
    // Defensive clamp even though the wire schema already caps `limit` at
    // CHANGE_HISTORY_LIMIT (same defense-in-depth spirit as
    // `toolGetApplications`'s clamp in tools.ts).
    const limit = Math.min(input.limit ?? CHANGE_HISTORY_LIMIT, CHANGE_HISTORY_LIMIT);
    return { events: events.slice(0, limit) };
}

export interface SearchCompaniesOut {
    companies: CompanySearchHit[];
}

export async function toolSearchCompanies(
    deps: ToolDeps,
    input: { query: string; limit?: number },
): Promise<SearchCompaniesOut> {
    const limit = Math.min(input.limit ?? AGENT.COMPANY_SEARCH_LIMIT, AGENT.COMPANY_SEARCH_LIMIT);
    return { companies: await deps.searchCompanies(input.query, limit) };
}
