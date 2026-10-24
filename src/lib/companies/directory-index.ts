import { DIRECTORY_LETTER_PATH } from "@/lib/seo/indexability";
import { displayNameFromDomain } from "./company-name";
import { MIN_SITEMAP_ROLES, type IndexableCompanyDomain } from "./indexable";

/** What the directory pages say they list; the one sentence of prose on them. */
export const DIRECTORY_DESCRIPTION = `Companies with ${MIN_SITEMAP_ROLES} or more live roles on their own career pages.`;

/** Companies a hub page lists. */
export const HUB_COMPANY_LIMIT = 12;

/** Bucket for names that do not start with a Latin letter (digits, other scripts). */
const OTHER_LETTER = "#";

export interface DirectoryEntry {
  domain: string;
  name: string;
  openRoleCount: number;
}

export interface LetterGroup {
  letter: string;
  entries: DirectoryEntry[];
}

/** The one label a directory or hub list shows for a company: derived from its domain,
 *  because the directory docs carry no name (the page's own H1 is read from its job rows). */
const labelOf = ({ domain, openRoleCount }: IndexableCompanyDomain): DirectoryEntry => ({
  domain,
  name: displayNameFromDomain(domain),
  openRoleCount,
});

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

/** Pure: the A-Z index groups (then "#") over the indexable set, names sorted inside each. */
export function groupCompaniesByLetter(companies: readonly IndexableCompanyDomain[]): LetterGroup[] {
  const byLetter = new Map<string, DirectoryEntry[]>();
  for (const entry of companies.map(labelOf)) {
    const letter = letterOf(entry.name);
    byLetter.set(letter, [...(byLetter.get(letter) ?? []), entry]);
  }
  const rank = (letter: string) => (letter === OTHER_LETTER ? "￿" : letter);
  return [...byLetter]
    .sort(([a], [b]) => rank(a).localeCompare(rank(b)))
    .map(([letter, entries]) => ({ letter, entries: entries.sort((a, b) => a.name.localeCompare(b.name) || a.domain.localeCompare(b.domain)) }));
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
    .map(([domain]) => labelOf(byDomain.get(domain)!));
}
