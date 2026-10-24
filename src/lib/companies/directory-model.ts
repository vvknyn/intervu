/**
 * THE company directory: one ordered list of the companies the site lists, each with the name and
 * letter every surface shows. The sitemap's `/co/` entries, the `/co` index and letter pages, the hub
 * company lists, related companies, a company page's name and its indexability all read it, so they
 * cannot disagree about who is listed, under which name, or under which letter.
 *
 * Membership is decided from each candidate's own job rows plus the other candidates:
 *   M1  a host of the ATS-host registry is not a company;
 *   M4  no agreeing name and no dominant name: nothing honest to list it under (aggregators, hosts);
 *   M2  a name that does not agree with its domain but plainly belongs to another candidate's domain
 *       ("Fortive" on a subsidiary's domain) is carried by that other domain;
 *   M3  two domains showing one name: the one with more roles keeps it.
 * A cleaned name that is the top non-agreeing candidate on {@link VENDOR_MIN_DOMAINS} or more
 * candidates is a feed's artifact (a payroll or recruiting vendor), never shown as a company's name.
 * Candidates arrive by live roles, so exclusions are refilled from the next ones up to the cap.
 */
import { unstable_cache } from "next/cache";
import { labelsClaimedBy, primaryLabel, resolveCompanyName } from "@/lib/companies/company-name";
import { publicRoles } from "@/lib/companies/company-roles-query";
import { letterOf } from "@/lib/companies/directory-index";
import { fetchIndexableCompanyDomains, SITEMAP_COMPANY_CAP, type IndexableCompanyDomain } from "@/lib/companies/indexable";
import { fetchNameEvidence } from "@/lib/companies/listed-names";
import { ATS_PORTAL_HOSTNAME_RE, displayCompanyName } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/** A listed company, with the name and the letter every surface shows for it. */
export interface DirectoryCompany extends IndexableCompanyDomain {
  name: string;
  letter: string;
}

export interface Exclusion {
  domain: string;
  rule: "M1" | "M2" | "M3" | "M4";
  /** The name the domain would have been shown under, when it had one. */
  name?: string;
  /** The domain that carries the company instead (M2, M3). */
  owner?: string;
}

export interface Directory {
  companies: DirectoryCompany[];
  /** Lower-case cleaned names that are a feed's artifact, not any company's name. */
  vendors: string[];
  excluded: Exclusion[];
}

/** Candidates a vendor artifact must be the top non-agreeing name of before it is one. */
export const VENDOR_MIN_DOMAINS = 3;

/** Names stay put for hours; the directory re-reads at most this often. */
export const DIRECTORY_REVALIDATE_SECONDS = 6 * 60 * 60;

/**
 * Pure: the directory over `candidates` (most live roles first), `rows` being each one's job rows in
 * the same order. Lists at most `cap`.
 */
export function buildDirectory(candidates: readonly IndexableCompanyDomain[], rows: readonly (readonly PublicJob[])[], cap: number = SITEMAP_COMPANY_CAP): Directory {
  const excluded: Exclusion[] = [];
  const pool = candidates.flatMap((candidate, i) => {
    if (!ATS_PORTAL_HOSTNAME_RE.test(candidate.domain)) return [{ candidate, jobs: rows[i] ?? [] }];
    excluded.push({ domain: candidate.domain, rule: "M1" });
    return [];
  });

  const firstPass = pool.map(({ candidate, jobs }) => resolveCompanyName(jobs, candidate.domain));
  const strayDomains = new Map<string, number>();
  for (const { stray } of firstPass) if (stray) strayDomains.set(stray.toLowerCase(), (strayDomains.get(stray.toLowerCase()) ?? 0) + 1);
  const vendors = new Set([...strayDomains].filter(([, count]) => count >= VENDOR_MIN_DOMAINS).map(([name]) => name));

  const ownerOf = new Map<string, string>();
  for (const { candidate } of pool) {
    const label = primaryLabel(candidate.domain);
    if (label && !ownerOf.has(label)) ownerOf.set(label, candidate.domain);
  }

  const named: DirectoryCompany[] = [];
  pool.forEach(({ candidate, jobs }, i) => {
    const first = firstPass[i]!;
    const resolved = !first.agrees && first.stray && vendors.has(first.stray.toLowerCase()) ? resolveCompanyName(jobs, candidate.domain, vendors) : first;
    if (!resolved.agrees && resolved.source === "domain") {
      excluded.push({ domain: candidate.domain, rule: "M4" });
      return;
    }
    const name = displayCompanyName(resolved.value);
    const owner = resolved.agrees ? undefined : [...labelsClaimedBy(name)].map((label) => ownerOf.get(label)).find((domain) => domain && domain !== candidate.domain);
    if (owner) {
      excluded.push({ domain: candidate.domain, rule: "M2", name, owner });
      return;
    }
    named.push({ ...candidate, name, letter: letterOf(name) });
  });

  const byName = new Map<string, DirectoryCompany>();
  for (const company of [...named].sort(byRoles)) {
    const kept = byName.get(company.name.toLowerCase());
    if (kept) excluded.push({ domain: company.domain, rule: "M3", name: company.name, owner: kept.domain });
    else byName.set(company.name.toLowerCase(), company);
  }
  return { companies: [...byName.values()].sort(byRoles).slice(0, cap), vendors: [...vendors], excluded };
}

const byRoles = (a: IndexableCompanyDomain, b: IndexableCompanyDomain): number => b.openRoleCount - a.openRoleCount || a.domain.localeCompare(b.domain);

/** Thin I/O: the pool from `company_directory`, each candidate's rows from the jobs index. */
export async function fetchDirectory(
  readCandidates: () => Promise<IndexableCompanyDomain[]> = fetchIndexableCompanyDomains,
  readEvidence: (domains: readonly string[]) => Promise<PublicJob[][]> = fetchNameEvidence,
): Promise<Directory> {
  const candidates = await readCandidates();
  const rows = await readEvidence(candidates.map((c) => c.domain));
  return buildDirectory(candidates, rows.map((jobs) => publicRoles(jobs)));
}

const readCached = (): Promise<Pick<Directory, "companies" | "vendors">> =>
  unstable_cache(async () => {
    const { companies, vendors } = await fetchDirectory();
    return { companies, vendors };
  }, ["company-directory"], { revalidate: DIRECTORY_REVALIDATE_SECONDS })();

/** The read every page uses. Module state so a test (outside Next, where `unstable_cache` cannot run) can swap it. */
export const DIRECTORY_READER = { read: readCached };

export const getDirectory = (): Promise<Pick<Directory, "companies" | "vendors">> => DIRECTORY_READER.read();

/**
 * Whether `domain` is listed: the one rule that makes a company page indexable (see indexable.ts).
 * Fail-soft, unlike the sitemap: this runs inline in a page request, so a directory that cannot be
 * read means `false` plus ONE warning — a page that cannot prove it is listed is `noindex, follow`
 * for that render, never claimed indexable.
 */
export async function fetchCompanyInSitemapSet(domain: string, directory: typeof getDirectory = getDirectory): Promise<boolean> {
  try {
    return (await directory()).companies.some((c) => c.domain === domain);
  } catch (err) {
    console.warn(`fetchCompanyInSitemapSet(${domain}): directory read failed`, err);
    return false;
  }
}
