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
import { cleanCompany, displayCompanyName, isCompanyPlaceholder, titleCaseDisplay } from "@/lib/jobs/presentation";
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
  /** Did the shown name come from a candidate that names the domain's employer? `false` only for the bare
   *  domain label: a name the domain does not carry is never shown. */
  agrees: boolean;
  /** The share of the rows that carry a name at all whose name agrees with the domain: how corroborated
   *  the domain's identity is (0 when the label is shown). */
  share: number;
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
function hostParts(domain: string): { parts: string[]; tld: string } {
  const parts = domain.toLowerCase().split(".");
  const tld = parts.pop() ?? "";
  if (parts.length >= 2 && tld.length === 2 && (parts[parts.length - 1] ?? "").length <= 3) parts.pop();
  return { parts, tld };
}

function domainLabels(domain: string): { labels: string[]; brandTld: string | null } {
  const { parts, tld } = hostParts(domain);
  return { labels: parts.map(alnum).filter(Boolean).flatMap(labelVariants), brandTld: tld.length >= BRAND_TLD_MIN_LENGTH ? alnum(tld) : null };
}

/** An all-capitals page title longer than this is a banner ("FIVE GUYS"), not a spelling; shorter is an acronym ("AAFF"). */
const MAX_ACRONYM_LETTERS = 4;

const siteKey = (value: string): string => alnum(value.replace(/&/g, " and "));
const isBanner = (c: string): boolean => !/\p{Ll}/u.test(c) && (c.match(/\p{L}/gu)?.length ?? 0) > MAX_ACRONYM_LETTERS;

/** A site name that can expand a squashed label: 2 to 5 words of letters, digits, spaces and & . ' - only. */
const EXPANSION_MAX_WORDS = 5;
const EXPANSION_CHARS_RE = /^[\p{L}\p{N} &.'\u2019-]+$/u;
const DOMAIN_TOKEN_RE = /\.[a-z]{2,}\b/i;

/**
 * Can `label` be read as pieces taken in order from the start of successive tokens of `name`? Each piece is a
 * subsequence of ONE token that begins with that token's first letter ("pyramidhc" = Pyramid + h,c of Healthcare);
 * the first piece comes from the first token, later tokens may be skipped.
 */
function spellsFromWordStarts(label: string, name: string): boolean {
  const tokens = name.split(/[\s&]+/).map(siteKey).filter(Boolean);
  const isSubsequence = (token: string, piece: string): boolean => {
    let at = 0;
    for (const ch of token) if (ch === piece[at]) at++;
    return at === piece.length;
  };
  const consume = (rest: string, from: number, last: number): boolean => {
    if (!rest) return true;
    for (let t = from; t < last; t++) {
      if (tokens[t]![0] !== rest[0]) continue;
      for (let k = rest.length; k >= 1; k--) if (isSubsequence(tokens[t]!, rest.slice(0, k)) && consume(rest.slice(k), t + 1, tokens.length)) return true;
    }
    return false;
  };
  return consume(label, 0, Math.min(1, tokens.length));
}

/** A respelling the page title can be trusted for: cased (all lower-case is the domain written out), and not cut mid-phrase. */
const isSoundSpelling = (c: string): boolean => /\p{Lu}/u.test(c) && /^[\p{L}\p{N}]/u.test(c) && /[\p{L}\p{N}.)'\u2019]$/u.test(c);
const wordCount = (c: string): number => c.split(/\s+/).length;
/** A same-key respelling may not drop a space of `display` unless it marks the join with a case change (NaughtOne, FieldAI). */
const keepsWords = (c: string, display: string): boolean => wordCount(c) >= wordCount(display) || /\p{Ll}\p{Lu}/u.test(c);

/** The shortest whitespace-word prefix (2+ words) of `name` that already spells `label`: the rest is a tagline. */
function dropTagline(label: string, name: string): string {
  const words = name.split(/\s+/);
  for (let n = 2; n < words.length; n++) {
    const head = words.slice(0, n).join(" ");
    if (siteKey(head) === label) return head;
  }
  return name;
}

/** The shortest site name that `label` (a domain word) squashes: it spells the label's letters across 2+ words. */
function expandSquashedLabel(label: string, names: readonly string[]): string | undefined {
  const qualifies = (name: string) => {
    const words = name.split(/\s+/);
    return (
      words.length >= 2 && words.length <= EXPANSION_MAX_WORDS &&
      EXPANSION_CHARS_RE.test(name) && !DOMAIN_TOKEN_RE.test(name) && !isBanner(name) &&
      siteKey(words[0]!) !== label && spellsFromWordStarts(label, name)
    );
  };
  return names.filter(qualifies).map((name) => dropTagline(label, name)).filter(isSoundSpelling).sort((a, b) => a.length - b.length)[0];
}

/** Does `word` carry casing that plain title case lacks (BNSF, McCain, nVent, Sendik's)? */
const carriesCasing = (word: string): boolean => /['\u2019]/.test(word) || word !== word[0]!.toUpperCase() + word.slice(1).toLowerCase();

/**
 * The site name that is a proper name inside the label ("Dunkin'" in dunkindonuts, "St. Charles Health" in
 * stcharleshealthcare): its key is a proper prefix of the label, at least 3 letters, it passes the expansion
 * hygiene, and it carries evidence of being a name rather than a page title: 2+ words, or one word with its own
 * casing ("EverTrue", "ATI"; not "Home", "Careers"). The longest key wins.
 */
function prefixBrand(label: string, names: readonly string[]): string | undefined {
  const qualifies = (name: string) => {
    const key = siteKey(name);
    return (
      key.length >= 3 && key.length < label.length && label.startsWith(key) &&
      wordCount(name) <= EXPANSION_MAX_WORDS && EXPANSION_CHARS_RE.test(name) && !DOMAIN_TOKEN_RE.test(name) &&
      !isBanner(name) && isSoundSpelling(name) && (wordCount(name) >= 2 || carriesCasing(name))
    );
  };
  return names.filter(qualifies).sort((a, b) => siteKey(b).length - siteKey(a).length)[0];
}

/** The site name whose first word is the label with its own casing ("BNSF" from "BNSF Railway"). */
function respellFirstWord(label: string, display: string, names: readonly string[]): string | undefined {
  return names
    .map((name) => name.split(/\s+/)[0]!.replace(/[.,:;|]+$/, ""))
    .find((word) => word !== display && siteKey(word) === label && !isBanner(word) && carriesCasing(word) && isSoundSpelling(word));
}

/**
 * SP: the company's own spelling of the agreed name `display`. The first of the homepage `candidates`
 * (source order) that differs from `display` only in spaces, casing, punctuation or accents ("Aspen Dental"
 * for "Aspendental", "Air Liquide" for "AIR LIQUIDE") is shown; an all-capitals title is no spelling.
 * SQ: when `display` is only the host's squashed first label ("Pyramidhc" on pyramidhc.com) and no site
 * name respells it, the shortest 2-5 word site name that spells the label's letters across its words wins
 * ("Pyramid Healthcare"), or the site's cased first word when that is the label ("BNSF"). Otherwise `display` stands.
 * Guards: (1) SQ runs only for a one-word `display`; a spaced name is already spelled. (2) An expansion spells the
 * label from the starts of its words ("Pyramid Healthcare", not letters scattered through a phrase). (3) A 2+ word
 * prefix of an expansion that already spells the label is the name; the rest is a tagline ("Airbus Helicopters in Canada").
 * (4) A name that is a proper prefix of the label ("Dunkin'" for dunkindonuts) is the last resort, and needs 2+ words or
 * casing of its own. (5) Any respelling needs an upper-case letter and a clean start/end ("Children of America -" fails), and a
 * same-key one may not drop a space of `display` unless it marks the join by case ("NaughtOne" yes, "Sunlife" no).
 */
export function siteSpelling(display: string, candidates: readonly string[] = [], domain?: string): string {
  const spellings = candidates.map((c) => c.replace(/[®™©℠]/g, "").trim());
  const cleaned = spellings.map((c) => displayCompanyName(c));
  // A domain-shaped title ("McCain.com") is humanized by the cleaner ("Mc Cain"): only its raw form may respell.
  const respelled = [...spellings, ...cleaned.filter((_, i) => !DOMAIN_TOKEN_RE.test(spellings[i]!))].find((c) => c !== display && siteKey(c) === siteKey(display) && !isBanner(c) && isSoundSpelling(c) && keepsWords(c, display));
  if (respelled) return respelled;
  const label = domain ? alnum(hostParts(domain).parts.at(-1) ?? "") : "";
  if (!label || /\s/.test(display) || siteKey(display) !== label) return display;
  const cased = respellFirstWord(label, display, cleaned);
  if (cased) return cased;
  if (cleaned.some((c) => siteKey(c) === label)) return display;
  return expandSquashedLabel(label, cleaned) ?? prefixBrand(label, cleaned) ?? display;
}

/** True when the host's registrable label IS the name, letters only ("kering.com" for "Kering"; not "keringeyewear.com"). */
export function hostLabelIsName(domain: string, name: string): boolean {
  return alnum(hostParts(domain).parts.at(-1) ?? "") === alnum(name);
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
  /** The spelling shown for the group (see {@link shownSpelling}). */
  display: string;
  tokens: string[];
  /** How many OTHER groups this one is a strict token-prefix of. */
  extends: number;
};

/**
 * Fold a group keyed by another group's key plus a legal form ("ebayinc" onto "ebay") into that root: the rows
 * name the same employer, and the glued form is never shown when a root exists. Only the root's spellings are kept.
 */
function foldGluedLegalForms<T extends { count: number }>(groups: Map<string, T>): void {
  const rootsOf = (key: string) =>
    [...groups.keys()].filter((root) => key.length - root.length >= 3 && key.startsWith(root) && root.length >= 3 && LABEL_LEGAL_SUFFIXES.includes(key.slice(root.length)));
  const glued = new Map([...groups.keys()].map((key) => [key, rootsOf(key)] as const).filter(([, roots]) => roots.length > 0));
  for (const [key, roots] of glued) {
    const root = roots.filter((r) => !glued.has(r)).sort((a, b) => b.length - a.length)[0];
    if (!root) continue;
    groups.get(root)!.count += groups.get(key)!.count;
    groups.delete(key);
  }
}

/** Written in lower case with no space: a feed's flattening ("tdsynnex"), not a spelling anyone chose. */
const isFlat = (spelling: string): boolean => spelling === spelling.toLowerCase() && !/\s/.test(spelling);

/**
 * The spelling a group of spellings of one name is shown as: the most common that is not flat
 * ("TD SYNNEX" over "tdsynnex") and not an all-capitals banner ("Five Guys" over "FIVE GUYS"), the most common overall when all are; a tie goes to the one carrying case.
 */
function shownSpelling(spellings: ReadonlyMap<string, number>): string {
  const ranked = [...spellings].sort(([a, x], [b, y]) => y - x || Number(carriesCase(b)) - Number(carriesCase(a)));
  const cased = ([spelling]: [string, number]) => !isFlat(spelling);
  return (ranked.find((entry) => cased(entry) && !isBanner(entry[0])) ?? ranked.find(cased) ?? ranked[0]!)[0];
}

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
 *     resolver never emits a stem it derived on the corpus alone, so "Alpha
 *     Systems Inc" + "Alpha Networks LLC" (no bare "Alpha" row) produces no new
 *     name. The one exception is `hostSpelledStem`, where the domain is the
 *     second witness.
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
 * The brand a domain spells when the corpus names only its qualified entities, or `null`. Where no bare
 * root row exists, a leading token run whose key equals one of the host's labels ("Aliaxis" on aliaxis.it)
 * and that at least `MIN_BRANDED_SIBLINGS` groups with DISTINCT qualifiers share is the brand: the siblings
 * are one witness, the domain the second. Groups differing only by a legal suffix share a qualifier
 * (`brandTokens` drops it), so they count once. The run is spelled as the siblings' own leading words.
 */
function hostSpelledStem(groups: readonly NameGroup[], labels: readonly string[]): string | null {
  const stems = new Map<string, { run: number; qualifiers: Set<string>; spellings: Map<string, number> }>();
  for (const { display, tokens, count } of groups) {
    for (let run = 1; run < tokens.length; run += 1) {
      const key = tokens.slice(0, run).join("");
      if (!labels.includes(key)) continue;
      const stem = stems.get(key) ?? { run, qualifiers: new Set<string>(), spellings: new Map<string, number>() };
      const end = [...display.matchAll(/[a-z0-9]+/gi)][run - 1]!;
      const spelling = display.slice(0, end.index + end[0].length);
      stem.qualifiers.add(tokens.slice(run).join(" "));
      stem.spellings.set(spelling, (stem.spellings.get(spelling) ?? 0) + count);
      stems.set(key, stem);
    }
  }
  const [stem] = [...stems.values()]
    .filter((s) => s.qualifiers.size >= MIN_BRANDED_SIBLINGS)
    .sort((a, b) => a.run - b.run || b.qualifiers.size - a.qualifiers.size);
  return stem ? shownSpelling(stem.spellings) : null;
}

/**
 * Pure: pick the best-supported display name for a company from its own job
 * rows. Candidates are cleaned through `cleanCompany` first (it already
 * strips ATS tenant codes, duplicate parentheticals and domain-shaped
 * placeholders, and decodes URL-escaped text), then only those that agree with the domain
 * count (see `nameAgreeingWithDomain`). Spellings of one name (case, spacing, punctuation) vote
 * together, and the group is shown as its commonest spelling that is not flat lower-case.
 *
 * The brand root wins where one exists, because a row-count vote answers the
 * wrong question when a domain holds several legitimate legal entities: it
 * finds the busiest subsidiary, not the employer. Where no root exists the
 * vote still decides, so the name most rows agree on wins and one odd row (an
 * agency, an acquired brand) cannot rename the page. Ties resolve to
 * whichever group was encountered first: deterministic, not meaningful. Before that vote, a name the
 * domain itself spells and several distinct entities lead with wins (`hostSpelledStem`).
 *
 * Among agreeing candidates, one whose agreement begins at its first word beats one that only
 * contains the label further in ("Mohegan Sun" over "Wolf Mohegan Sun"); the vote decides within.
 * With no agreeing candidate the answer is the bare domain label: a name the domain does not carry is
 * not evidence about who the domain is, however many rows state it.
 */
export function resolveCompanyName(jobs: readonly Pick<PublicJob, "company">[], domain: string): CompanyDisplayName {
  const host = domainLabels(domain);
  const spellings = new Map<string, { count: number; spellings: Map<string, number> }>();
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
    if (!name) continue;
    const group = spellings.get(alnum(name)) ?? { count: 0, spellings: new Map<string, number>() };
    group.count += 1;
    group.spellings.set(name, (group.spellings.get(name) ?? 0) + 1);
    spellings.set(alnum(name), group);
  }

  foldGluedLegalForms(spellings);
  const all = [...spellings.values()].map(({ count, spellings: forms }) => {
    const display = shownSpelling(forms);
    return { count, display, tokens: brandTokens(display), extends: 0, lead: agreesWithLabels(display, host, true) };
  });
  const candidates = all.some((g) => g.lead) ? all.filter((g) => g.lead) : all;
  for (const candidate of candidates) {
    candidate.extends = candidates.filter((other) => isStrictTokenPrefix(candidate.tokens, other.tokens)).length;
  }

  let best: NameGroup | null = pickBrandRoot(candidates);
  const stem = best ? null : hostSpelledStem(candidates, host.labels);
  if (stem) best = { count: 0, display: stem, tokens: brandTokens(stem), extends: 0 };
  if (!best) {
    for (const group of candidates) {
      if (!best || group.count > best.count) best = group;
    }
  }

  if (best) return { ...casedName(best.display), agrees: true, share: all.reduce((agreeing, g) => agreeing + g.count, 0) / named };
  return { value: displayNameFromDomain(domain), source: "domain", agrees: false, share: 0 };
}

function casedName(display: string): Pick<CompanyDisplayName, "value" | "source"> {
  if (carriesCase(display)) return { value: display, source: "corpus-cased" };
  // No spelling carried case: the name is exactly as casing-free as a bare domain label, so it gets
  // the same recovery — see `capitalizeAfterNonLetter`. `source` stays "corpus-flat": this is still
  // the corpus's own string, not a guess.
  // A 2-3 letter single token is read as an acronym by `titleCaseDisplay`'s own rule ("dhl" -> "DHL"; ordinary words stay words).
  // An all-capitals banner carries no case either, and `titleCaseDisplay` is the rule that recovers it ("PEOPLE AND BABY" -> "People and Baby").
  const value = /^\p{L}{2,3}$/u.test(display) ? titleCaseDisplay(display.toUpperCase()) : isBanner(display) ? titleCaseDisplay(display) : capitalizeAfterNonLetter(display);
  return { value, source: "corpus-flat" };
}
