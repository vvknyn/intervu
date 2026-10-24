import { HUB_COMPANY_LIMIT, namedEntries, topHubCompanies, type NamedEntry } from "@/lib/companies/directory-index";
import type { IndexableCompanyDomain } from "@/lib/companies/indexable";
import { getListedNames } from "@/lib/companies/listed-names";
import { searchJobs } from "@/lib/jobs/search";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";
import { careerHubSearchParams, type CareerHub } from "@/lib/seo/career-hubs";
import { resolveIndexableCompanies } from "@/lib/seo/sitemap-entries";

/** Newest matching roles a hub lists. */
export const HUB_ROLE_LIMIT = 50;

/** Hits per hub search; the companies are grouped from this window (the search has no company facet). */
const HUB_SEARCH_WINDOW = 200;

/** What a hub states, each part present only when read: its live matching role count, the
 *  newest matching roles, and the companies with most matching roles. */
export interface HubFacts {
  total: number | null;
  roles: PublicJob[];
  companies: NamedEntry[];
}

interface HubFactsDeps {
  search: (params: JobSearchParams) => Promise<JobSearchResult>;
  indexable: () => Promise<IndexableCompanyDomain[]>;
  names: (domains: readonly string[]) => Promise<Record<string, string>>;
}

const REAL_DEPS: HubFactsDeps = { search: searchJobs, indexable: resolveIndexableCompanies, names: getListedNames };

const logOmitted = (hub: CareerHub, what: string, why: unknown) =>
  console.error(`career hub ${hub.slug}: ${what} omitted: ${why instanceof Error ? why.message : String(why)}`);

/** One newest-first search per hub; a failed or unavailable read omits what it feeds, never throws. */
export async function loadHubFacts(hub: CareerHub, deps: HubFactsDeps = REAL_DEPS): Promise<HubFacts> {
  let result: JobSearchResult;
  try {
    result = await deps.search({ ...careerHubSearchParams(hub), sort: "newest", limit: HUB_SEARCH_WINDOW });
    if (result.unavailable) throw new Error("job search unavailable");
  } catch (error) {
    logOmitted(hub, "role count, roles and companies", error);
    return { total: null, roles: [], companies: [] };
  }
  const facts: HubFacts = { total: result.total, roles: result.hits.slice(0, HUB_ROLE_LIMIT), companies: [] };
  try {
    const top = topHubCompanies(result.hits, await deps.indexable(), HUB_COMPANY_LIMIT);
    facts.companies = namedEntries(top, await deps.names(top.map((c) => c.domain)));
  } catch (error) {
    logOmitted(hub, "companies", error);
  }
  return facts;
}
