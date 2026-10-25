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
 *       subdomain, then more live roles — unless their legal names tell them apart (`distinctLegalNames`),
 *       when each is listed under its own.
 * Each listed company's `openRoleCount` is that number as of the memo build (up to 6h old): it ranks,
 * thresholds and caps only, and is never displayed. A displayed count of a listed company comes from
 * ONE count generation (below), rebuilt every 30 min with the company page's own count function, so the
 * letter rows, the related rows and the company page itself show the same number. A domain no built
 * generation holds is read fresh with `fetchOpenCounts` (listed-names.ts), the same query the page uses.
 * Candidates arrive by raw live roles, so exclusions are refilled from the next ones up to the cap.
 */
import { carriesLegalTail, hostLabelNamesCompany, registrableLabel, resolveCompanyName, isBetterSpelling, nameKey, siteSpellings, withoutSitePurpose } from "@/lib/companies/company-name";
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
type Claim = { company: DirectoryCompany; majority: boolean; hostIsName: boolean; legal: string; unsettled: string; identity: string };

/**
 * Pure: `name` with its legal form, from the first of `candidates` (resolver value, site names, row/wikidata
 * spellings) that carries one and displays as `name` — it only adds a form to the name shown ("Marmon
 * Holdings, Inc." never stands in for "Marmon"). "" when none does.
 */
export const legalNameOf = (name: string, candidates: readonly string[]): string =>
  candidates.find((c) => carriesLegalTail(c) && displayCompanyName(c).toLowerCase() === name.toLowerCase()) ?? "";

/**
 * Pure: of domains showing one name, those that are told apart by their legal name (`legalNameOf`,
 * "ORBIS Inc." / "ORBIS Corporation"): it exists, differs case-insensitively from
 * every other's, and the registrable label differs from every other's (linde-mh.ie and linde-mh.co.uk are
 * one company). Fewer than two such domains tell nothing apart, so the result is empty and M3 applies.
 */
export function distinctLegalNames(group: readonly { domain: string; legal: string }[]): Set<string> {
  const unique = (key: (m: { domain: string; legal: string }) => string, m: { domain: string; legal: string }) => group.filter((o) => key(o) === key(m)).length === 1;
  const told = group.filter((m) => m.legal !== "" && unique((o) => o.legal.toLowerCase(), m) && unique((o) => registrableLabel(o.domain), m));
  return new Set(told.length >= 2 ? told.map((m) => m.domain) : []);
}

/** The claims, each of those `distinctLegalNames` tells apart within its name's collision renamed to its legal name. */
function listUnderLegalNames(claims: readonly Claim[]): Claim[] {
  const groups = Map.groupBy(claims, (c) => c.company.name.toLowerCase());
  const told = new Set([...groups.values()].flatMap((g) => [...distinctLegalNames(g.map((c) => ({ domain: c.company.domain, legal: c.legal })))]));
  return claims.map((c) => (told.has(c.company.domain) ? { ...c, unsettled: c.legal, identity: c.legal, company: { ...c.company, name: c.legal, letter: letterOf(c.legal) } } : c));
}

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
    const roles = publicRoles(read.hits);
    const resolved = resolveCompanyName(roles, candidate.domain);
    if (!resolved.agrees) return void excluded.push({ domain: candidate.domain, rule: "R1" });
    if (candidate.openRoleCount < minRoles) return void excluded.push({ domain: candidate.domain, rule: "T1" });
    const { name, unsettled, identity } = siteSpellings(displayCompanyName(resolved.value), candidate.siteNames, candidate.domain, resolved.rowSpelling, candidate.labelSpellings, roles.map((role) => role.company ?? ""));
    claims.push({ company: { ...candidate, name, letter: letterOf(name) }, majority: resolved.share >= MAJORITY_SHARE, hostIsName: [unsettled, identity, name].some((own) => hostLabelNamesCompany(candidate.domain, own)), legal: legalNameOf(name, [resolved.value, ...(candidate.siteNames ?? []), ...(candidate.labelSpellings ?? [])]), unsettled, identity });
  });

  // A name owns both its listed fold and its unsettled one: refining the display must not change who a duplicate is.
  const owners = new Map<string, number>();
  const kept: DirectoryCompany[] = [];
  for (const { company, unsettled, identity } of listUnderLegalNames(claims).sort(byClaim)) {
    // A careers-purpose domain is its company: the names are also compared without a trailing site-purpose word.
    const keys = [company.name, unsettled, identity].flatMap((own) => [own, withoutSitePurpose(own)]).map(nameKey);
    const at = keys.map((key) => owners.get(key)).find((i) => i !== undefined);
    if (at === undefined) {
      keys.forEach((key) => owners.set(key, kept.length));
      kept.push(company);
      continue;
    }
    excluded.push({ domain: company.domain, rule: "M3", owner: kept[at]!.domain });
    // The same letters spelled with word boundaries: the survivor keeps its domain and shows the better spelling. A collision through the unsettled key keeps its own name.
    if (nameKey(kept[at]!.name) === keys[0] && isBetterSpelling(company.name, kept[at]!.name)) kept[at] = { ...kept[at]!, name: company.name, letter: company.letter };
  }
  return { companies: kept.sort(byRoles).slice(0, cap), excluded };
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
