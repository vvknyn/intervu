/**
 * THE company directory: one ordered list of the companies the site lists, each with the name and
 * letter every surface shows. The sitemap's `/co/` entries, the `/co` index and letter pages, the hub
 * company lists, related companies, a company page's name and its indexability all read it, so they
 * cannot disagree about who is listed, under which name, or under which letter.
 *
 * Membership is decided from each candidate's own job rows plus the other candidates:
 *   M1  a host of the ATS-host registry is not a company;
 *   R1  the name must agree with the domain: a domain whose rows name no one it carries (a dominant
 *       name that belongs elsewhere, a vendor's name, no name) is an uncorroborated identity and is
 *       not listed — a page for it still renders, as `noindex`, under its domain label;
 *   M3  two domains showing one name: the higher agreement share keeps it, then the apex over a
 *       subdomain, then more live roles.
 * Candidates arrive by live roles, so exclusions are refilled from the next ones up to the cap.
 */
import { hostLabelIsName, resolveCompanyName } from "@/lib/companies/company-name";
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
  rule: "M1" | "R1" | "M3";
  /** The domain that keeps the name instead (M3). */
  owner?: string;
}

export interface Directory {
  companies: DirectoryCompany[];
  excluded: Exclusion[];
}

/** Names stay put for hours; the directory re-reads at most this often. */
export const DIRECTORY_REVALIDATE_SECONDS = 6 * 60 * 60;

/** A candidate's `share` of rows is a majority from here up. */
const MAJORITY_SHARE = 0.5;

/** A listable candidate and how strongly it holds the name it is listed under. */
type Claim = { company: DirectoryCompany; majority: boolean; hostIsName: boolean };

const byRoles = (a: IndexableCompanyDomain, b: IndexableCompanyDomain): number => b.openRoleCount - a.openRoleCount || a.domain.localeCompare(b.domain);

/** Who keeps a name two domains show: a majority of rows carrying it, a host label that is the name, fewer host labels, the busier. */
const byClaim = (a: Claim, b: Claim): number =>
  Number(b.majority) - Number(a.majority) ||
  Number(b.hostIsName) - Number(a.hostIsName) ||
  a.company.domain.split(".").length - b.company.domain.split(".").length ||
  byRoles(a.company, b.company);

/**
 * Pure: the directory over `candidates` (most live roles first), `rows` being each one's job rows in
 * the same order. Lists at most `cap`.
 */
export function buildDirectory(candidates: readonly IndexableCompanyDomain[], rows: readonly (readonly PublicJob[])[], cap: number = SITEMAP_COMPANY_CAP): Directory {
  const excluded: Exclusion[] = [];
  const claims: Claim[] = [];
  candidates.forEach((candidate, i) => {
    if (ATS_PORTAL_HOSTNAME_RE.test(candidate.domain)) return void excluded.push({ domain: candidate.domain, rule: "M1" });
    const resolved = resolveCompanyName(rows[i] ?? [], candidate.domain);
    if (!resolved.agrees) return void excluded.push({ domain: candidate.domain, rule: "R1" });
    const name = displayCompanyName(resolved.value);
    claims.push({ company: { ...candidate, name, letter: letterOf(name) }, majority: resolved.share >= MAJORITY_SHARE, hostIsName: hostLabelIsName(candidate.domain, name) });
  });

  const byName = new Map<string, DirectoryCompany>();
  for (const { company } of claims.sort(byClaim)) {
    const kept = byName.get(company.name.toLowerCase());
    if (kept) excluded.push({ domain: company.domain, rule: "M3", owner: kept.domain });
    else byName.set(company.name.toLowerCase(), company);
  }
  return { companies: [...byName.values()].sort(byRoles).slice(0, cap), excluded };
}

/** Thin I/O: the pool from `company_directory`, each candidate's rows from the jobs index. */
export async function fetchDirectory(
  readCandidates: () => Promise<IndexableCompanyDomain[]> = fetchIndexableCompanyDomains,
  readEvidence: (domains: readonly string[]) => Promise<PublicJob[][]> = fetchNameEvidence,
): Promise<Directory> {
  const candidates = await readCandidates();
  const rows = await readEvidence(candidates.map((c) => c.domain));
  return buildDirectory(candidates, rows.map((jobs) => publicRoles(jobs)));
}

/** What a {@link singleFlight} remembers; held by the caller so several bundles of one process can share it. */
export interface FlightStore<T> {
  value?: T;
  builtAt?: number;
  inflight?: Promise<T>;
}

/**
 * A read that builds `build()` once at a time: every caller of a cold read shares the one in-flight
 * build (and sees its failure; the next read builds again), and a value older than `ttlMs` is served
 * as it is while ONE background refresh runs. A failed refresh keeps the old value and is retried on
 * the next read.
 */
export function singleFlight<T>(build: () => Promise<T>, ttlMs: number, store: FlightStore<T> = {}, now: () => number = Date.now): () => Promise<T> {
  const start = (): Promise<T> => {
    store.inflight ??= build().then(
      (value) => {
        Object.assign(store, { value, builtAt: now(), inflight: undefined });
        return value;
      },
      (error: unknown) => {
        store.inflight = undefined;
        throw error;
      },
    );
    return store.inflight;
  };
  return () => {
    if (store.builtAt === undefined) return store.inflight ?? start();
    if (!store.inflight && now() - store.builtAt >= ttlMs) {
      start().catch((error: unknown) => console.warn("directory refresh failed; serving the previous build", error));
    }
    return Promise.resolve(store.value as T);
  };
}

type ListedDirectory = Pick<Directory, "companies">;

// On globalThis: the server-start hook is bundled apart from the pages, and its copy of this module must
// fill the memo the pages read.
const flights = globalThis as { __velaiDirectoryFlight?: FlightStore<ListedDirectory> };

const readMemo = singleFlight(
  async (): Promise<ListedDirectory> => ({ companies: (await fetchDirectory()).companies }),
  DIRECTORY_REVALIDATE_SECONDS * 1000,
  (flights.__velaiDirectoryFlight ??= {}),
);

/** The read every page uses. Module state so a test can swap it. */
export const DIRECTORY_READER = { read: readMemo };

export const getDirectory = (): Promise<ListedDirectory> => DIRECTORY_READER.read();

/**
 * Whether `domain` is listed: the one rule that makes a company page indexable (see indexable.ts).
 * A directory that cannot be read rejects: a failed read is not a membership answer, so the page
 * errors rather than render `noindex` as if the company were unlisted.
 */
export async function fetchCompanyInSitemapSet(domain: string, directory: typeof getDirectory = getDirectory): Promise<boolean> {
  return (await directory()).companies.some((c) => c.domain === domain);
}
