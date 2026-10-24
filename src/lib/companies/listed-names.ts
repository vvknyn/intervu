import { unstable_cache } from "next/cache";
import { resolveCompanyName } from "@/lib/companies/company-name";
import { companyRolesParams, publicRoles } from "@/lib/companies/company-roles-query";
import { meiliSearchEach } from "@/lib/jobs/meilisearch";
import { displayCompanyName } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/** Everything the name and the dedupe/internal-posting filters read from a role row. */
const EVIDENCE_ATTRIBUTES = ["id", "company", "company_domain", "title", "location", "location_city", "location_state", "location_country", "work_type"] as const;

/** Queries per /multi-search request. */
const BATCH = 50;

/** Names stay put for hours; a page that lists them re-reads at most this often. */
export const LISTED_NAMES_REVALIDATE_SECONDS = 6 * 60 * 60;

/** Rows per domain, in the order asked: the company page's own roles query, fewer attributes. */
export type EvidenceFetcher = (domains: readonly string[]) => Promise<PublicJob[][]>;

export const fetchNameEvidence: EvidenceFetcher = async (domains) => {
  const batches: string[][] = [];
  for (let i = 0; i < domains.length; i += BATCH) batches.push(domains.slice(i, i + BATCH));
  const rows = await Promise.all(
    batches.map((batch) => meiliSearchEach(batch.map((domain) => ({ params: companyRolesParams(domain), attributesToRetrieve: EVIDENCE_ATTRIBUTES })))),
  );
  return rows.flat();
};

/** Module state (survives across requests): every name resolved so far, served when a later read fails. */
export const LAST_GOOD_NAMES = new Map<string, string>();

/**
 * The name a company page's H1 shows, for each of `domains`: `resolveCompanyName` over the same
 * rows, then `displayCompanyName`. The domain label appears only when the resolver has no evidence,
 * exactly as on the H1. When the read fails the last good names serve if they cover every domain;
 * otherwise this throws — a failed read is never papered over with domain labels.
 */
export async function resolveListedNames(
  domains: readonly string[],
  fetchEvidence: EvidenceFetcher = fetchNameEvidence,
  lastGood: Map<string, string> = LAST_GOOD_NAMES,
): Promise<Record<string, string>> {
  try {
    const rows = await fetchEvidence(domains);
    const names = Object.fromEntries(domains.map((domain, i) => [domain, displayCompanyName(resolveCompanyName(publicRoles(rows[i] ?? []), domain).value)]));
    for (const [domain, name] of Object.entries(names)) lastGood.set(domain, name);
    return names;
  } catch (error) {
    const known = domains.filter((domain) => lastGood.has(domain));
    if (known.length < domains.length) throw error;
    console.error(`listed names: read failed, serving the last good names: ${error instanceof Error ? error.message : String(error)}`);
    return Object.fromEntries(known.map((domain) => [domain, lastGood.get(domain)!]));
  }
}

/** {@link resolveListedNames}, cached for {@link LISTED_NAMES_REVALIDATE_SECONDS}. */
const readCached = (domains: readonly string[]): Promise<Record<string, string>> =>
  unstable_cache((list: string[]) => resolveListedNames(list), ["listed-company-names"], { revalidate: LISTED_NAMES_REVALIDATE_SECONDS })([...domains].sort());

/** The read every page uses. Module state so a test (outside Next, where `unstable_cache` cannot run) can swap it. */
export const NAME_READER = { read: readCached };

export const getListedNames = (domains: readonly string[]): Promise<Record<string, string>> => NAME_READER.read(domains);
