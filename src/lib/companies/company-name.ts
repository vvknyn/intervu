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
 *
 * SELECTION is a second, separate problem from casing. One `company_domain`
 * routinely carries several *legitimately different* legal entities, and a
 * plain row-count vote hands the page whichever subsidiary happens to post
 * most. Live 2026-08-11, lumentum.com:
 *
 *     64  Lumentum Operations LLC
 *     63  Lumentum International (Thailand) Co. Ltd.   <- what the page showed
 *     25  Lumentum Japan, Inc.
 *     21  Lumentum Ottawa ULC
 *      2  Lumentum                                     <- the brand
 *
 * `pickBrandRoot` resolves that WITHOUT knowing any company's name: it looks
 * for a candidate whose own tokens are a strict prefix of several siblings'
 * tokens, which is the shape "one brand, many qualified entities" makes in
 * any corpus. See that function for the safety argument.
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

/**
 * Trailing tokens that state a legal FORM rather than say anything about who
 * the employer is ("Inc.", "LLC", "Co. Ltd.", "GmbH", "Pte", "Private
 * Limited", "S.A.", "K.K.", "ULC" …). Used ONLY to compare two names, never
 * to build one — see `brandTokens`.
 *
 * This is a lexicon of legal forms, not a list of companies: it is closed over
 * the world's company-registry vocabulary, so no employer is ever "added" to
 * it. Only a TRAILING run is dropped, which is what keeps genuine names that
 * open with one of these tokens intact ("AB InBev", "AG Barr", "LTD
 * Commodities"), and at least one token always survives, so an employer whose
 * whole name is such a word is never hollowed out.
 */
const LEGAL_FORM_TOKENS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
  "llc", "lc", "llp", "lp", "ltd", "ltda", "limited", "plc", "ulc",
  "gmbh", "mbh", "ag", "kg", "ohg", "se", "ab", "as", "asa", "aps", "oy", "oyj",
  "nv", "bv", "sa", "sas", "sarl", "srl", "spa", "sl", "slu", "sp", "sro",
  "kk", "kabushiki", "kaisha", "pte", "pty", "pvt", "private", "sdn", "bhd",
]);

/**
 * A name reduced to its comparison key: lowercase alphanumeric tokens with any
 * trailing legal-form run removed. NEVER rendered — the value the page shows
 * is always a string the corpus actually asserted, which is what makes the
 * suffix list unable to mangle anyone's name. "Lumentum Japan, Inc." and
 * "Lumentum Ottawa ULC" reduce to ["lumentum","japan"] / ["lumentum","ottawa"]
 * so the shared root is visible; both still DISPLAY verbatim if chosen.
 */
export function brandTokens(name: string): string[] {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let end = tokens.length;
  while (end > 1 && LEGAL_FORM_TOKENS.has(tokens[end - 1]!)) end -= 1;
  return tokens.slice(0, end);
}

/** Is `root` a strict, token-aligned prefix of `full`? Token alignment is what
 *  stops "Lume" claiming "Lumentum" and "Bank" claiming "Bankers Trust". */
function isStrictTokenPrefix(root: readonly string[], full: readonly string[]): boolean {
  if (root.length === 0 || root.length >= full.length) return false;
  return root.every((token, i) => full[i] === token);
}

/**
 * How many differently-named siblings a candidate must extend before it is
 * treated as the brand. Two, because that is the difference between the
 * pattern this rule exists for — several qualified entities under one brand —
 * and a single two-name domain, where "Acme" alongside "Acme Corporation"
 * carries no evidence about which of the two the employer calls itself.
 * Below the bar the resolver simply keeps the row-count vote it always used.
 */
const MIN_BRANDED_SIBLINGS = 2;

/** Last-resort label from the domain: "acme-corp.com" -> "Acme Corp". */
export function displayNameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type NameGroup = {
  count: number;
  cased: string | null;
  verbatim: string;
  tokens: string[];
  /** How many OTHER groups this one is a strict token-prefix of. */
  extends: number;
};

/**
 * The brand among several legal entities, or `null` when the corpus doesn't
 * show one.
 *
 * A candidate qualifies only when it is a strict token-prefix of at least
 * `MIN_BRANDED_SIBLINGS` other candidates — i.e. the corpus itself shows the
 * same stem being qualified several different ways ("Lumentum" + Operations /
 * Japan / Ottawa / Technology UK …). That is the signature of a brand with
 * subsidiaries, and it is evidence carried by the data rather than by a rule
 * about any particular company.
 *
 * Three properties make it safe:
 *   - The winner is a string the corpus ASSERTED as a whole company name. The
 *     resolver never emits a stem it derived, so "Alpha Systems Inc" +
 *     "Alpha Networks LLC" (no bare "Alpha" row) produces no new name.
 *   - The legal-form strip only ever touches the comparison key, so an
 *     employer whose real name ends in one ("Levi Strauss & Co.") still
 *     displays in full — it is simply also able to be recognised as the root
 *     of "… Japan KK".
 *   - Fewer than two qualified siblings means no qualification pattern, and
 *     the caller falls back to the row-count vote that shipped before.
 * Ordering: shortest stem first (the brand, not a mid-level holding name),
 * then the one qualifying most siblings, then the most-attested — all three
 * total, so the result never depends on row order.
 */
export function pickBrandRoot(groups: readonly NameGroup[]): NameGroup | null {
  const roots = groups.filter((g) => g.extends >= MIN_BRANDED_SIBLINGS);
  if (roots.length === 0) return null;
  return roots.sort(
    (a, b) =>
      a.tokens.length - b.tokens.length || b.extends - a.extends || b.count - a.count,
  )[0]!;
}

/**
 * Pure: pick the best-supported display name for a company from its own job
 * rows. Candidates are cleaned through `cleanCompany` first (it already
 * strips ATS tenant codes, duplicate parentheticals and domain-shaped
 * placeholders, and decodes URL-escaped text), then tallied under a
 * case-insensitive key — mirroring `dominantCompanyDomain`
 * (company-stats.ts).
 *
 * The brand root wins where one exists, because a row-count vote answers the
 * wrong question when a domain holds several legitimate legal entities: it
 * finds the busiest subsidiary, not the employer. Where no root exists the
 * vote still decides, so the name most rows agree on wins and one odd row (an
 * agency, an acquired brand) cannot rename the page. Ties resolve to
 * whichever group was encountered first: deterministic, not meaningful.
 */
export function resolveCompanyName(
  jobs: readonly Pick<PublicJob, "company">[],
  domain: string,
): CompanyDisplayName {
  const groups = new Map<string, NameGroup>();

  for (const job of jobs) {
    const name = cleanCompany(job.company);
    if (!name) continue;
    const key = name.toLowerCase();
    const group = groups.get(key) ?? {
      count: 0,
      cased: null,
      verbatim: name,
      tokens: brandTokens(name),
      extends: 0,
    };
    group.count += 1;
    if (!group.cased && carriesCase(name)) group.cased = name;
    groups.set(key, group);
  }

  const candidates = [...groups.values()];
  for (const candidate of candidates) {
    candidate.extends = candidates.filter((other) =>
      isStrictTokenPrefix(candidate.tokens, other.tokens),
    ).length;
  }

  let best: NameGroup | null = pickBrandRoot(candidates);
  if (!best) {
    for (const group of candidates) {
      if (!best || group.count > best.count) best = group;
    }
  }

  if (!best) return { value: displayNameFromDomain(domain), source: "domain" };
  if (best.cased) return { value: best.cased, source: "corpus-cased" };
  return { value: best.verbatim, source: "corpus-flat" };
}
