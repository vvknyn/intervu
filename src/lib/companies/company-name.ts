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
import { cleanCompany, isCompanyPlaceholder } from "@/lib/jobs/presentation";
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
  /** Did the shown name come from a candidate that names the domain's employer? `false` for a dominant
   *  non-agreeing name and for the bare domain label. */
  agrees: boolean;
  /** The shown name's share of the rows that carry a name at all (0 when none does). */
  share: number;
  /** The most-attested cleaned candidate that does NOT agree with the domain, or null: the evidence the
   *  directory pool tallies to spot a vendor artifact. */
  stray: string | null;
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

/**
 * Capitalize the start of every "word" in a caseless string — after any
 * non-letter, not just `\b` word boundaries. `\b\w` alone leaves a run
 * untouched wherever a digit sits directly against a letter ("23andme",
 * "1password"), because `\d` and `\w` letters are both `\b`-equivalent so no
 * boundary exists between them. Digits themselves are left as-is (there is
 * no case to fix on "2" or "3") — only the run of letters immediately after
 * one now starts a new capitalized "word", same as a space or hyphen already
 * does. All-caps input passes through unchanged: there is no lowercase
 * letter to recase, which is correct — all-caps carries no case information
 * to recover in the first place (see `carriesCase`).
 *
 * Shared by every source that is exactly as casing-free as a bare domain
 * label: the domain fallback below, and a `corpus-flat` name in
 * `resolveCompanyName` (a winning name group with no cased witness among its
 * rows carries zero casing information, same as a domain label).
 */
export function capitalizeAfterNonLetter(value: string): string {
  return value.replace(/(^|[^\p{L}])(\p{Ll})/gu, (_m, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

/**
 * Last-resort label from the domain: "acme-corp.com" -> "Acme Corp".
 */
export function displayNameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return capitalizeAfterNonLetter(label.replace(/-/g, " "));
}

/** Joiner words that initials skip: "International Business Machines" and "Bank of America" are both IBM-shaped. */
const SMALL_WORDS = new Set(["of", "and", "the"]);

/** A leading identifier token (one containing a digit) and the separator joining it to the rest:
 *  "94-1687665 Bank of America", "CA10382-CANADA AIR LIQUIDE", "04D Federal Reserve Bank". */
const LEADING_IDENTIFIER_RE = /^([A-Za-z]*\d[A-Za-z0-9]*(?:-\d[A-Za-z0-9]*)*)[-_\s]+(?=\S)/;

/** A TLD this long is a brand ("home.sandvik"), not a registry code (.com, .org, .ca). */
const BRAND_TLD_MIN_LENGTH = 4;

/** Diacritics folded away ("Société" -> "Societe"): agreement compares letters, not accents. */
const fold = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "");

const alnum = (value: string): string => fold(value).toLowerCase().replace(/[^a-z0-9]/g, "");

/** The legal forms a label may end in ("nrssinc" -> "nrss"): the lexicon `brandTokens` drops, at three
 *  letters or more so a label's own tail ("co", "sa") is never read as one. */
const LABEL_LEGAL_SUFFIXES = [...LEGAL_FORM_TOKENS].filter((token) => token.length >= 3);

/** A label and the forms it also answers to: without trailing digits ("cea3" -> "cea"), without a
 *  trailing legal form ("nrssinc" -> "nrss"), or both. */
function labelVariants(label: string): string[] {
  const undigited = label.replace(/\d+$/, "");
  const forms = [label, undigited.length >= 2 ? undigited : label];
  for (const base of [label, undigited]) {
    const suffix = LABEL_LEGAL_SUFFIXES.find((token) => base.endsWith(token) && base.length - token.length >= 3);
    if (suffix) forms.push(base.slice(0, -suffix.length));
  }
  return [...new Set(forms)];
}

/**
 * The comparison labels of a host, squashed to alphanumerics ("aerospace.circor.com" ->
 * ["aerospace", "circor"]): every label but the TLD. A short second-level label under a country TLD
 * ("co" in x.co.uk) is structure, not identity, and is dropped. A brand TLD is returned apart: it
 * names the employer only as the candidate's whole first word ("Sandvik" on home.sandvik), never as
 * a substring ("Careerplug" on avanta.care).
 */
function domainLabels(domain: string): { labels: string[]; brandTld: string | null } {
  const parts = domain.toLowerCase().split(".");
  const tld = parts.pop() ?? "";
  if (parts.length >= 2 && tld.length === 2 && (parts[parts.length - 1] ?? "").length <= 3) parts.pop();
  return { labels: parts.map(alnum).filter(Boolean).flatMap(labelVariants), brandTld: tld.length >= BRAND_TLD_MIN_LENGTH ? alnum(tld) : null };
}

type Word = { text: string; optional: boolean };

/** Words split on non-alphanumerics and camelCase ("GlobalFoundries" -> Global Foundries). A word of
 *  three letters or fewer that the source wrote lower-case (of, at, and), or a leading "The", may be skipped. */
function wordsOf(segment: string): Word[] {
  return segment
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((raw, i) => ({
      text: raw.toLowerCase(),
      optional: (raw.length <= 3 && raw === raw.toLowerCase()) || (i === 0 && raw.toLowerCase() === "the"),
    }));
}

/** Is `label` a concatenation of non-empty prefixes of successive `words`? Every required word up to
 *  the last one used contributes; trailing words may go unused. */
function composedFromPrefixes(label: string, words: readonly Word[], i = 0): boolean {
  if (label === "") return true;
  const word = words[i];
  if (!word) return false;
  if (word.optional && composedFromPrefixes(label, words, i + 1)) return true;
  for (let k = 1; k <= Math.min(word.text.length, label.length); k++) {
    if (label[k - 1] !== word.text[k - 1]) return false;
    if (composedFromPrefixes(label.slice(k), words, i + 1)) return true;
  }
  return false;
}

const containsLabel = (squashed: string, label: string): boolean =>
  label.length >= 3 ? squashed.includes(label) : squashed === label;

/** Does `segment` name the employer behind `labels`? Contains a label, starts with a word the label
 *  contains, has initials equal to a label, or composes a label from word prefixes. `leadOnly` keeps
 *  only the readings that begin at the segment's first word (no "contains a label somewhere inside"). */
function agreesWithLabels(segment: string, { labels, brandTld }: ReturnType<typeof domainLabels>, leadOnly = false): boolean {
  const text = fold(segment);
  const squashes = [alnum(text), ...(text.includes("&") ? [alnum(text.replace(/&/g, " and "))] : [])];
  const words = brandTokens(text);
  const first = words[0] ?? "";
  const initials = words.map((w) => w[0]).join("");
  const significantInitials = words.filter((w) => !SMALL_WORDS.has(w)).map((w) => w[0]).join("");
  const composable = wordsOf(text);
  const named = (squashed: string, label: string) =>
    leadOnly ? (label.length >= 3 ? squashed.startsWith(label) : squashed === label) : containsLabel(squashed, label);
  return first === brandTld || labels.some(
    (label) =>
      squashes.some((squashed) => named(squashed, label)) ||
      (first.length >= 3 && label.includes(first)) ||
      (label.length >= 2 && (label === initials || label === significantInitials || composedFromPrefixes(label, composable))),
  );
}

/** Segments of a compound name: a spaced dash, "dba", "d/b/a" or "at" ("Acme dba Acme Foods"). */
const SEGMENT_SEPARATOR_RE = /\s+(?:[–—-]|dba|d\/b\/a|at)\s+/i;

/** A word that reads as a code or a franchise prefix rather than a name: all capitals, or carrying a digit. */
const isCodeWord = (word: string): boolean => /\d/.test(word) || (word === word.toUpperCase() && word !== word.toLowerCase());

/** Leading code words dropped when the name's first word does not itself name the employer but a
 *  later word does ("LPSC Ayvens" -> "Ayvens", "CANADA AIR LIQUIDE" -> "AIR LIQUIDE"). */
function dropLeadingCodes(name: string, host: ReturnType<typeof domainLabels>): string {
  if (agreesWithLabels(name, host, true)) return name;
  const words = name.split(/\s+/);
  for (let i = 1; i < words.length && isCodeWord(words[i - 1]!); i++) {
    const tail = words.slice(i).join(" ");
    if (agreesWithLabels(tail, host, true)) return tail;
  }
  return name;
}

/**
 * The corpus string, reduced to the part that agrees with the domain, or `null` when none does.
 * A corpus `company` string is whatever the feed carried: an ATS vendor on a tenant's rows, another
 * employer after an acquisition, a registry code glued to the name. The domain is the one fact
 * known for certain, so a candidate is shown only if it names the employer the domain belongs to.
 *   1. a leading identifier token goes ("94-1687665 Bank of America" -> "Bank of America") unless the
 *      domain label starts with it ("84 Lumber" on 84lumber.com, "3M" on 3m.com keep theirs);
 *      (and is kept whole when stripping it would cost the agreement: "L3Harris Technologies");
 *   2. "_" reads as a space; the whole string must agree, and the shortest segment (split on " - ",
 *      " dba ", " d/b/a ", " at ") that itself contains a label then replaces it ("Mohegan Sun Mohegan
 *      Tribal Gaming Authority - Mohegan Sun");
 *   3. leading all-capital or digit-bearing words go when a later word starts the agreement
 *      ("LPSC Ayvens" on ayvens.com).
 */
export function nameAgreeingWithDomain(candidate: string, domain: string): string | null {
  const host = domainLabels(domain);
  const { labels } = host;
  const spaced = candidate.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const identifier = LEADING_IDENTIFIER_RE.exec(spaced)?.[1];
  const keepsIdentifier = identifier !== undefined && labels.some((label) => label.startsWith(alnum(identifier)));
  const stripped = identifier && !keepsIdentifier ? spaced.slice(identifier.length).replace(/^[-_\s]+/, "") : spaced;
  // The unstripped string stands when stripping the identifier would cost the agreement ("L3Harris Technologies").
  const body = [stripped, spaced].find((text) => text && agreesWithLabels(text, host));
  if (!body) return null;
  const [shortest] = body
    .split(SEGMENT_SEPARATOR_RE)
    .map((part) => part.trim())
    .filter((part) => labels.some((label) => containsLabel(alnum(part), label)))
    .sort((a, b) => a.length - b.length);
  return dropLeadingCodes(shortest ?? body, host);
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
 *
 * Among agreeing candidates, one whose agreement begins at its first word beats one that only
 * contains the label further in ("Mohegan Sun" over "Wolf Mohegan Sun"); the vote decides within.
 * With no agreeing candidate, the top candidate is shown when it holds at least
 * {@link DOMINANT_NAME_SHARE} of the named rows and is not one of `vendorNames` (lower-case cleaned
 * names the caller knows to be a feed's artifact); otherwise the bare domain label.
 */
export function resolveCompanyName(
  jobs: readonly Pick<PublicJob, "company">[],
  domain: string,
  vendorNames: ReadonlySet<string> = new Set(),
): CompanyDisplayName {
  const host = domainLabels(domain);
  const groups = new Map<string, NameGroup & { lead: boolean }>();
  const strays = new Map<string, { name: string; count: number }>();
  let named = 0;

  for (const job of jobs) {
    // A row whose raw `company` is an ATS portal hostname or bare domain
    // (e.g. "acme.applicantpro.com") isn't the corpus asserting a name — see
    // `isCompanyPlaceholder`. `cleanCompany` still extracts a best-effort
    // label from it ("Acme"), but treating that guess as corpus evidence is
    // what let a placeholder outrank the true domain fallback ("Acme Corp"
    // from acme-corp.com) and get labelled `corpus-cased` besides. Skipped
    // here so such rows count for nothing, same as an empty name.
    if (isCompanyPlaceholder(job.company)) continue;
    const cleaned = cleanCompany(job.company);
    if (!cleaned) continue;
    named += 1;
    // Only a string that agrees with the domain is evidence about this domain's employer.
    const name = nameAgreeingWithDomain(cleaned, domain);
    if (!name) {
      const stray = strays.get(cleaned.toLowerCase()) ?? { name: cleaned, count: 0 };
      stray.count += 1;
      strays.set(cleaned.toLowerCase(), stray);
      continue;
    }
    const key = name.toLowerCase();
    const group = groups.get(key) ?? {
      count: 0,
      cased: null,
      verbatim: name,
      tokens: brandTokens(name),
      extends: 0,
      lead: agreesWithLabels(name, host, true),
    };
    group.count += 1;
    if (!group.cased && carriesCase(name)) group.cased = name;
    groups.set(key, group);
  }

  const all = [...groups.values()];
  const candidates = all.some((g) => g.lead) ? all.filter((g) => g.lead) : all;
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

  const topStray = [...strays.values()].reduce<{ name: string; count: number } | null>((top, s) => (!top || s.count > top.count ? s : top), null);
  const stray = topStray?.name ?? null;
  const share = (count: number) => (named ? count / named : 0);

  if (best) return { ...casedName(best), agrees: true, share: share(best.count), stray };
  const dominant = topStray && share(topStray.count) >= DOMINANT_NAME_SHARE && !vendorNames.has(topStray.name.toLowerCase()) ? topStray : null;
  if (dominant) {
    return { ...casedName({ cased: carriesCase(dominant.name) ? dominant.name : null, verbatim: dominant.name }), agrees: false, share: share(dominant.count), stray };
  }
  return { value: displayNameFromDomain(domain), source: "domain", agrees: false, share: 0, stray };
}

/** Share of the named rows a non-agreeing candidate needs to be shown as the company's name. */
export const DOMINANT_NAME_SHARE = 0.6;

function casedName(group: Pick<NameGroup, "cased" | "verbatim">): Pick<CompanyDisplayName, "value" | "source"> {
  if (group.cased) return { value: group.cased, source: "corpus-cased" };
  // No row among the winning group carried case: the group is exactly as casing-free as a bare
  // domain label, so it gets the same recovery — see `capitalizeAfterNonLetter`. `source` stays
  // "corpus-flat": this is still the corpus's own string, not a guess.
  return { value: capitalizeAfterNonLetter(group.verbatim), source: "corpus-flat" };
}

/** The alphanumeric label that names `domain` itself ("aerospace.circor.com" -> "circor"). */
export function primaryLabel(domain: string): string {
  return domainLabels(domain).labels.at(-1) ?? "";
}

/** Shortest label a name may claim on another domain's behalf. */
const CLAIM_MIN_LENGTH = 3;

/**
 * The domain labels a displayed name asserts as its own: any run of its leading WORDS squashed
 * together ("Palo Alto Networks" -> paloalto, paloaltonetworks; "WPP Media" -> wpp), and the initials
 * of its significant words ("International Business Machines" -> ibm), each of at least
 * {@link CLAIM_MIN_LENGTH} characters. A label that starts mid-word ("Graybar" -> "gray") or in a later
 * word ("Genuine Parts" -> "parts") is not claimed.
 */
export function labelsClaimedBy(name: string): Set<string> {
  const words = fold(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const claimed = new Set<string>();
  let run = "";
  for (const word of words) {
    run += word;
    claimed.add(run);
  }
  claimed.add(words.filter((w) => !SMALL_WORDS.has(w)).map((w) => w[0]).join(""));
  return new Set([...claimed].filter((label) => label.length >= CLAIM_MIN_LENGTH));
}
