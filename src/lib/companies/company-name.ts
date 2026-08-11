/**
 * Company display-name resolution for the domain-keyed company surfaces
 * (`/co/[slug]`'s `get-company.ts` and the hot list).
 *
 * The corpus's `company` string is unreliable in CASE, not just in noise:
 * many rows arrive case-flattened by an upstream feed — live 2026-08-11,
 * rows literally carry "1password", "10xgenomics", "23andme" — and NO
 * general rule can turn a flat string back into its official rendering.
 * "1password" is equally consistent with "1Password", "1PASSWORD" and
 * "1password". `titleCaseDisplay` (lib/jobs/presentation.ts) is the repo's
 * general re-casing rule and it deliberately cannot help here: its
 * word-initial uppercase lands on the leading digit, so "1password" comes
 * back unchanged, and forcing a guess would BREAK the names it currently
 * gets right (it turns a genuinely all-caps "IBM" into "Ibm").
 *
 * So casing is recovered the only way that cannot fabricate it: from the
 * corpus itself. A company's rows come from multiple feeds and the
 * flattening is per-feed, so when ANY row spells the same name with mixed
 * case, that row carries the employer's real rendering and wins. When no row
 * does, the flat string is returned VERBATIM and flagged `corpus-flat`, so
 * the renderer can degrade honestly rather than present a guess as fact.
 *
 * This is why the fix generalizes: nothing here knows any company's name.
 * Adding an employer whose feed is flattened costs no code change — it is
 * repaired if a sibling row carries case, and honestly flagged if not.
 */
import { cleanCompany } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/** Provenance of a resolved name — never "we made this up". */
export type CompanyNameSource =
  /** The corpus's own string, and it carried case information. Trustworthy. */
  | "corpus-cased"
  /** The corpus's own string, VERBATIM, but case-flattened (or all-caps): the
   *  casing shown is the feed's, not provably the employer's. Not a guess —
   *  but not authoritative either. */
  | "corpus-flat"
  /** No usable name in the corpus at all; label derived from the domain. */
  | "domain";

export type CompanyDisplayName = {
  value: string;
  source: CompanyNameSource;
};

/**
 * Does this string carry case information at all? Same expression
 * `titleCaseDisplay` (lib/jobs/presentation.ts) uses for its own
 * `hasMixedCase` guard, so "is this string's casing meaningful?" is decided
 * one way across the repo. All-caps counts as NOT carrying case: a scraped
 * "ACME CORP" and a real "IBM" are indistinguishable in a bare string, so
 * both are shown verbatim and flagged rather than re-cased.
 */
export function carriesCase(value: string): boolean {
  return value !== value.toLowerCase() && value !== value.toUpperCase();
}

/** Last-resort label from the domain: "acme-corp.com" -> "Acme Corp". */
export function displayNameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pure: pick the best-supported display name for a company from its own job
 * rows. Candidates are cleaned through `cleanCompany` first (it already
 * strips ATS tenant codes, duplicate parentheticals and domain-shaped
 * placeholders, and decodes URL-escaped text), then tallied under a
 * case-insensitive key — mirroring `dominantCompanyDomain`
 * (company-stats.ts), so the name most rows agree on wins and one odd row
 * (an agency, a subsidiary) cannot rename the page. Ties resolve to
 * whichever group was encountered first: deterministic, not meaningful.
 */
export function resolveCompanyName(
  jobs: readonly Pick<PublicJob, "company">[],
  domain: string,
): CompanyDisplayName {
  type Group = { count: number; cased: string | null; verbatim: string };
  const groups = new Map<string, Group>();

  for (const job of jobs) {
    const name = cleanCompany(job.company);
    if (!name) continue;
    const key = name.toLowerCase();
    const group = groups.get(key) ?? { count: 0, cased: null, verbatim: name };
    group.count += 1;
    if (!group.cased && carriesCase(name)) group.cased = name;
    groups.set(key, group);
  }

  let best: Group | null = null;
  for (const group of groups.values()) {
    if (!best || group.count > best.count) best = group;
  }

  if (!best) return { value: displayNameFromDomain(domain), source: "domain" };
  if (best.cased) return { value: best.cased, source: "corpus-cased" };
  return { value: best.verbatim, source: "corpus-flat" };
}
