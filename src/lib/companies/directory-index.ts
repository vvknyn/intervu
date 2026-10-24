import { DIRECTORY_LETTER_PATH } from "@/lib/seo/indexability";
import { displayNameFromDomain } from "./company-name";
import { MIN_SITEMAP_ROLES, type IndexableCompanyDomain } from "./indexable";

/** What the directory pages say they list; the one sentence of prose on them. */
export const DIRECTORY_DESCRIPTION = `Companies with ${MIN_SITEMAP_ROLES} or more live roles on their own career pages.`;

/** Companies a hub page lists. */
export const HUB_COMPANY_LIMIT = 12;

/** Bucket for names that do not start with a Latin letter (digits, other scripts). */
const OTHER_LETTER = "#";

/** A listed company: the directory docs carry no name, so it is read separately ({@link namedEntries}). */
export interface DirectoryEntry {
  domain: string;
  openRoleCount: number;
}

export interface LetterGroup {
  letter: string;
  entries: DirectoryEntry[];
}

export interface NamedEntry extends DirectoryEntry {
  name: string;
}

/** A-Z for a Latin start (accents folded: "é" -> "E"), else "#". */
function letterOf(name: string): string {
  const first = name.normalize("NFD").replace(/\p{M}/gu, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : OTHER_LETTER;
}

/** Path of one letter's page: lower-case letter, "other" for the "#" bucket. */
export function letterPath(letter: string): string {
  return `${DIRECTORY_LETTER_PATH}/${letter === OTHER_LETTER ? "other" : letter.toLowerCase()}`;
}

/** The letter a URL segment names (inverse of {@link letterPath}'s last part). */
export function letterFromSegment(segment: string): string {
  return segment === "other" ? OTHER_LETTER : segment.toUpperCase();
}

/** Pure: the A-Z index groups (then "#") over the indexable set. The bucket is the first letter of the
 *  domain's label: it is known for every company without reading any job rows, so the index and every
 *  letter page agree on the set; the name each entry shows comes from {@link namedEntries}. */
export function groupCompaniesByLetter(companies: readonly IndexableCompanyDomain[]): LetterGroup[] {
  const byLetter = new Map<string, DirectoryEntry[]>();
  for (const { domain, openRoleCount } of companies) {
    const letter = letterOf(displayNameFromDomain(domain));
    byLetter.set(letter, [...(byLetter.get(letter) ?? []), { domain, openRoleCount }]);
  }
  const rank = (letter: string) => (letter === OTHER_LETTER ? "￿" : letter);
  return [...byLetter].sort(([a], [b]) => rank(a).localeCompare(rank(b))).map(([letter, entries]) => ({ letter, entries }));
}

/** Pure: `entries` with the names a company page's H1 shows (`names`, keyed by domain), sorted by name. */
export function namedEntries(entries: readonly DirectoryEntry[], names: Readonly<Record<string, string>>): NamedEntry[] {
  return entries
    .map((entry) => {
      const name = names[entry.domain];
      if (name === undefined) throw new Error(`no name read for ${entry.domain}`);
      return { ...entry, name };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.domain.localeCompare(b.domain));
}

/** Pure: companies behind a hub query's hits, most matching roles first, only those in the
 *  indexable set (so every link points at a page the sitemap also lists). */
export function topHubCompanies(
  hits: readonly { company_domain: string | null }[],
  indexable: readonly IndexableCompanyDomain[],
  limit: number = HUB_COMPANY_LIMIT,
): DirectoryEntry[] {
  const byDomain = new Map(indexable.map((c) => [c.domain.toLowerCase(), c]));
  const matches = new Map<string, number>();
  for (const { company_domain } of hits) {
    const domain = company_domain?.toLowerCase();
    if (domain && byDomain.has(domain)) matches.set(domain, (matches.get(domain) ?? 0) + 1);
  }
  return [...matches]
    .sort(([da, na], [db, nb]) => nb - na || da.localeCompare(db))
    .slice(0, limit)
    .map(([domain]) => {
      const { domain: listed, openRoleCount } = byDomain.get(domain)!;
      return { domain: listed, openRoleCount };
    });
}
