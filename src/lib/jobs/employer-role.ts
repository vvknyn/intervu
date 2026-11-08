import { parseQuotedOrPhrases } from "./fit-phrases";
import { displayCompanyBrand } from "./presentation";
import type { EmployerRead, JobSearchParams, JobSearchResult, PublicJob } from "./types";

/**
 * A search for a role at one employer (Vivek, 2026-11-08: "searching product
 * manager integral ad science should search for product manager jobs in that
 * company if it exists... if not, show integral ad science jobs followed by
 * product manager jobs").
 *
 * The rule, whichever way the employer arrived (named in the typed words,
 * `company-intent.ts`; or chosen as the employer filter with role words typed):
 *   1. the role at the employer, when it has any;
 *   2. otherwise the employer's other roles, then the role at other employers,
 *      in that order, and the page says so (`employerRoleNote`, result-state.ts).
 * The order is one list, paged like one list (`employerFallbackWindow`).
 */

/** The employer filter the searcher chose, read as a role at that employer when role words are typed with it. */
export function chosenEmployerRole(p: JobSearchParams): { domain: string; role: string } | null {
  const domain = (p.companyDomain ?? "").trim().toLowerCase();
  const role = (p.q ?? "").trim();
  if (!domain || !role || p.id || p.board || p.companyDomains?.length || p.fromResume) return null;
  // A résumé's quoted titles are its own lanes, never an employer read.
  if (parseQuotedOrPhrases(role)) return null;
  return { domain, role };
}

/** `p` pinned to the employer's domain(s), the way `applyCompanyDomainPin` pins it. */
export function pinToEmployer(p: JobSearchParams, domains: readonly string[]): JobSearchParams {
  const { companyDomain: _one, companyDomains: _many, ...rest } = p;
  return domains.length === 1 ? { ...rest, companyDomain: domains[0] } : { ...rest, companyDomains: [...domains] };
}

/** `p` with no employer pin: the role at every employer. */
export function withoutEmployer(p: JobSearchParams): JobSearchParams {
  const { companyDomain: _one, companyDomains: _many, ...rest } = p;
  return rest;
}

/** The employer's name as its own rows show it, or undefined when no row is the employer's. */
export function employerNameFromHits(hits: readonly PublicJob[], domains: readonly string[]): string | undefined {
  const wanted = new Set(domains.map((d) => d.toLowerCase()));
  const hit = hits.find((h) => wanted.has((h.company_domain ?? "").toLowerCase()) && (h.company ?? "").trim());
  return hit ? displayCompanyBrand(hit.company, hit.company_domain, hit.title) || hit.company || undefined : undefined;
}

/**
 * Pure: the rows of the fallback list's second half (the role at other
 * employers) a page needs, once the first half's size is known. The list is
 * the employer's `employerTotal` roles, then the role elsewhere: a page past
 * the employer's roles reads on into the second half from its start. Null when
 * the employer's roles fill the page.
 */
export function employerFallbackWindow(
  employerTotal: number,
  offset: number,
  limit: number,
): { offset: number; limit: number } | null {
  const owed = offset + limit - Math.max(offset, employerTotal);
  return owed > 0 ? { offset: Math.max(0, offset - employerTotal), limit: owed } : null;
}

/** A row's tier says where a tiered search's title matches end; in the joined list the employer's roles lead instead. */
const withoutTier = (hit: PublicJob): PublicJob => {
  if (hit.tier === undefined) return hit;
  const { tier: _tier, ...rest } = hit;
  return rest;
};

/**
 * Pure: one result from the fallback's two halves. `role` is the second
 * half's page (its window from `employerFallbackWindow`; with no window its
 * rows are not shown, only its total counts). Rows the first half already
 * holds are not listed twice. `effectiveQ` is empty: the list is in the
 * order given, so the page must not re-sort it into titled and mention blocks
 * around the role words.
 */
export function joinEmployerFallback(
  employer: JobSearchResult,
  role: JobSearchResult,
  read: Omit<EmployerRead, "roleMatches" | "employerRoles">,
  showRoleRows: boolean,
): JobSearchResult {
  const seen = new Set(employer.hits.map((h) => h.id));
  const roleRows = showRoleRows ? role.hits.filter((h) => !seen.has(h.id)) : [];
  return {
    hits: [...employer.hits, ...roleRows].map(withoutTier),
    total: employer.total + role.total,
    backend: employer.backend,
    configured: employer.configured && role.configured,
    facetDistribution: role.facetDistribution ?? employer.facetDistribution,
    ...(employer.engineMs !== undefined || role.engineMs !== undefined
      ? { engineMs: (employer.engineMs ?? 0) + (role.engineMs ?? 0), engineCalls: (employer.engineCalls ?? 0) + (role.engineCalls ?? 0) }
      : {}),
    effectiveQ: "",
    employer: {
      ...read,
      name: read.name ?? employerNameFromHits(employer.hits, read.domains),
      roleMatches: 0,
      employerRoles: employer.total,
    },
  };
}
