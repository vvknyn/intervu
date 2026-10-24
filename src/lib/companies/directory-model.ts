/**
 * THE company directory: one ordered list of the companies the site lists, each with the name and
 * letter every surface shows. The sitemap's `/co/` entries, the `/co` index and letter pages, the hub
 * company lists, related companies, a company page's name and its indexability all read it, so they
 * cannot disagree about who is listed, under which name, or under which letter.
 *
 * Membership is decided from each candidate's own job rows plus the other candidates:
 *   M1  a host of the ATS-host registry is not a company;
 *   T1  the open-roles number every page shows (`companyOpenCount`: deduped, no internal postings) is
 *       below the listing threshold — the raw `company_directory` tally only nominates candidates;
 *   R1  the name must agree with the domain: a domain whose rows name no one it carries (a dominant
 *       name that belongs elsewhere, a vendor's name, no name) is an uncorroborated identity and is
 *       not listed — a page for it still renders, as `noindex`, under its domain label;
 *   M3  two domains showing one name: the higher agreement share keeps it, then the apex over a
 *       subdomain, then more live roles.
 * Each listed company's `openRoleCount` is that number as of the memo build (up to 6h old): it ranks,
 * thresholds and caps only, and is never displayed. A displayed count of a listed company comes from
 * ONE count generation (below), rebuilt every 30 min with the company page's own count function, so the
 * letter rows, the related rows and the company page itself show the same number. A domain no built
 * generation holds is read fresh with `fetchOpenCounts` (listed-names.ts), the same query the page uses.
 * Candidates arrive by raw live roles, so exclusions are refilled from the next ones up to the cap.
 */
import { hostLabelIsName, resolveCompanyName, siteSpelling } from "@/lib/companies/company-name";
import { companyOpenCount, publicRoles } from "@/lib/companies/company-roles-query";
import { letterOf } from "@/lib/companies/directory-index";
import { fetchIndexableCompanyDomains, MIN_SITEMAP_ROLES, SITEMAP_COMPANY_CAP, type IndexableCompanyDomain } from "@/lib/companies/indexable";
import { fetchNameEvidence, fetchOpenCounts } from "@/lib/companies/listed-names";
import type { OpenCount } from "@/lib/companies/open-count";
import { ATS_PORTAL_HOSTNAME_RE, displayCompanyName } from "@/lib/jobs/presentation";
import type { EachResult } from "@/lib/jobs/meilisearch";

/** A listed company, with the name and the letter every surface shows for it. */
export interface DirectoryCompany extends IndexableCompanyDomain {
  name: string;
  letter: string;
}

export interface Exclusion {
  domain: string;
  rule: "M1" | "T1" | "R1" | "M3";
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
 * Pure: the directory over `candidates` (most raw live roles first), `reads` being each one's roles
 * read in the same order. Lists at most `cap`, by open-roles number, those with at least `minRoles`.
 */
export function buildDirectory(candidates: readonly IndexableCompanyDomain[], reads: readonly EachResult[], cap: number = SITEMAP_COMPANY_CAP, minRoles: number = MIN_SITEMAP_ROLES): Directory {
  const excluded: Exclusion[] = [];
  const claims: Claim[] = [];
  candidates.forEach((raw, i) => {
    if (ATS_PORTAL_HOSTNAME_RE.test(raw.domain)) return void excluded.push({ domain: raw.domain, rule: "M1" });
    const read = reads[i] ?? { hits: [], total: 0 };
    const candidate = { ...raw, openRoleCount: companyOpenCount(read).value };
    const resolved = resolveCompanyName(publicRoles(read.hits), candidate.domain);
    if (!resolved.agrees) return void excluded.push({ domain: candidate.domain, rule: "R1" });
    if (candidate.openRoleCount < minRoles) return void excluded.push({ domain: candidate.domain, rule: "T1" });
    const name = siteSpelling(displayCompanyName(resolved.value), candidate.siteNames, candidate.domain, resolved.rowSpelling, candidate.labelSpellings);
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
  readEvidence: (domains: readonly string[]) => Promise<EachResult[]> = fetchNameEvidence,
): Promise<Directory> {
  const candidates = await readCandidates();
  const rows = await readEvidence(candidates.map((c) => c.domain));
  return buildDirectory(candidates, rows);
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

/**
 * How long a count generation serves before ONE background rebuild. A build reads every listed domain
 * (~3000, ~100 s of Meilisearch work on the box), so it cannot run per request; counts drift slowly
 * (measured: 27 of 3000 differed over ~20 min), so 30 min keeps every surface close to the live number.
 */
export const COUNT_GENERATION_TTL_MS = 30 * 60 * 1000;

/** The open-roles number of every listed company, as of one build. */
export type CountGeneration = ReadonlyMap<string, OpenCount>;

/** Reads the listed domains' counts. A failed read throws, so the previous generation is kept. */
export const buildCountGeneration = async (directory: typeof getDirectory = getDirectory, readEvidence: typeof fetchNameEvidence = fetchNameEvidence): Promise<CountGeneration> => {
  const domains = (await directory()).companies.map((c) => c.domain);
  const results = await readEvidence(domains);
  return new Map(domains.map((domain, i) => [domain, companyOpenCount(results[i]!)]));
};

/**
 * The one chokepoint for a listed company's displayed count. `peek` is the built generation (none on a
 * cold boot) and starts a build or refresh when one is due; it never waits for one. `resolve` takes a
 * domain from the generation when it holds it and reads the rest fresh.
 */
export function createCountGeneration(build: () => Promise<CountGeneration>, store: FlightStore<CountGeneration> = {}) {
  const read = singleFlight(build, COUNT_GENERATION_TTL_MS, store);
  const peek = (): CountGeneration | undefined => {
    read().catch((error: unknown) => console.warn("open count generation build failed; serving the previous one, if any", error));
    return store.value;
  };
  const resolve = async (domains: readonly string[], fresh: typeof fetchOpenCounts = fetchOpenCounts): Promise<Map<string, OpenCount>> => {
    const generation = peek();
    const counts = new Map<string, OpenCount>();
    const rest: string[] = [];
    for (const domain of domains) {
      const held = generation?.get(domain);
      if (held) counts.set(domain, held);
      else rest.push(domain);
    }
    if (rest.length) for (const [domain, count] of await fresh(rest)) counts.set(domain, count);
    return counts;
  };
  return { peek, resolve };
}

// On globalThis for the same reason as the directory memo: the boot hook and the pages bundle apart.
const countFlights = globalThis as { __velaiCountFlight?: FlightStore<CountGeneration> };

const COUNTS = createCountGeneration(() => buildCountGeneration(), (countFlights.__velaiCountFlight ??= {}));

/** The built count generation, if any; starts the first build or a due refresh. */
export const peekCountGeneration = COUNTS.peek;

/** Counts for listed-company rows: the generation's value where it holds the domain, else a fresh read. */
export const resolveOpenCounts = COUNTS.resolve;
