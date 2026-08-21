import { ghostBadgeTone, STATUS_PILL } from "@/lib/ui/status-tokens";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { formatRelativeAge, isStale, RESULT_LINE_FRESH_MS } from "@/lib/jobs/freshness";
import { checkFreshness } from "@/lib/jobs/badges";
import type { GhostBadge, GhostChecked, PostedBucket, PublicJob } from "@/lib/jobs/types";
import { toValueArray } from "@/lib/jobs/types";

/**
 * Pure presentation helpers for a job posting — the vocabulary the ledger row
 * and the detail panel BOTH speak.
 *
 * These lived in app/page.tsx while `/` was the only surface rendering a job.
 * `JobDetail` now also opens from a pursuit (/yours/[id]), so they moved here
 * rather than being duplicated: two copies of "how do we clean a company name"
 * is exactly how one surface starts disagreeing with another about the same
 * posting. Everything here is pure — no clock reads, no I/O — so callers thread
 * their own `now` and these stay usable from a render body.
 */

// Ghost-badge presentation. Colors route through `ghostBadgeTone`
// (lib/ui/status-tokens.ts) — the ONE badge→tone decision — rather than a
// hand-picked STATUS_PILL entry per badge. That hand-picked copy had already
// drifted: `ghostBadgeTone` was introduced to stop `caution` and
// `likely_ghost` sharing one amber tone ("collapsing 'review' and 'possible
// ghost' into the same color hid the worse verdict", its own doc), and the
// radar bars and mix bands were moved onto it — but this map, which every
// BADGE-rendering surface reads (SERP row tooltip, detail-panel verdict pill,
// /co roles list), kept `likely_ghost: STATUS_PILL.intv` and stayed amber.
// A possible-ghost posting therefore looked identical to a merely-cautioned
// one everywhere a reader actually meets a posting. Derived now, so the two
// can't disagree again.
//
// The `dot` field is gone with the same edit: it had no consumer anywhere in
// src (a third palette copy kept alive only by the type), and leaving a
// second color source next to a fix for a second color source invites the
// exact drift this removes.
const ghostPill = (badge: "clear" | "caution" | "likely_ghost") => STATUS_PILL[ghostBadgeTone(badge)];

export const GHOST_META: Record<GhostBadge, { label: string; cls: string; explain: string } | null> = {
    // "Ghost job" is jobseeker-forum vocabulary. It reads as insider jargon to
    // anyone who has not met it before — and the corpus is not a tech corpus
    // (nursing and physical therapy each match as many live postings as
    // software engineering), so most readers have not. Feedback from the
    // medical field, 2026-08-17.
    //
    // The replacement is not just plainer, it is more honest. "Ghost" asserts
    // the employer's INTENT — a posting kept up to farm résumés. What the
    // signals below actually measure is whether a posting still looks live:
    // freshness, repost history, whether pay is disclosed. "Possibly stale"
    // is the claim the evidence supports; "possible ghost job" was a claim
    // about motive we cannot see.
    //
    // The term is deliberately KEPT on /research/ghost-jobs and its metadata:
    // people search for "ghost jobs", so it earns its place as an acquisition
    // surface. It is the in-product labels that had to change.
    likely_ghost: {
        label: "Possibly stale",
        cls: ghostPill("likely_ghost"),
        explain:
            "Our signals suggest this posting may no longer be live — it could be old, permanently open, or already filled. Worth verifying before you invest time.",
    },
    caution: {
        label: "Worth verifying",
        cls: ghostPill("caution"),
        explain: "Some signals suggest this posting is worth a quick sanity-check before you apply.",
    },
    clear: {
        label: "Actively posted",
        cls: ghostPill("clear"),
        explain: "Nothing suggests this posting is stale — it looks active.",
    },
    unscored: null,
};

/**
 * Neutral "hasn't been re-checked" stand-in for `GHOST_META.clear` (Phase
 * 1-a #5) — same shape, used instead of it whenever `checkFreshness` says
 * the check backing a "clear" verdict is stale. Keeps the positive, green
 * "no ghost signals" claim from surviving past the point the data behind it
 * stopped being current (the observed bug: a green badge on a 99-112-day-old
 * check sitting next to a dead apply link).
 */
export const STALE_CLEAR_META: NonNullable<(typeof GHOST_META)["clear"]> = {
    label: "Not recently verified",
    cls: STATUS_PILL.intv,
    explain: "This posting hasn't been re-checked recently — we can't confirm it's still active. Worth a quick sanity-check before you apply.",
};

/**
 * Single chokepoint for which `GHOST_META` entry a job's row badge AND
 * detail-panel banner render from — so the two surfaces can never disagree
 * about whether a verdict is still current.
 *
 * Staleness does two different jobs here, and it used to do only the first:
 *
 *   1. It DEMOTES a stale "clear". A green "no ghost signals" pill is a
 *      present-tense safety claim; when the check behind it is a month old
 *      the claim outlives its evidence, so `STALE_CLEAR_META` replaces it.
 *
 *   2. It DATES every other stale verdict. "Worth verifying" and "Possible
 *      ghost job" also speak in the present tense ("some signals suggest…"),
 *      and until 2026-08-17 they were exempt from the staleness branch
 *      entirely — a caution verdict from an 89-day-old check rendered
 *      identically to one from this morning. It keeps its label (dropping a
 *      warning because we stopped looking is the dangerous direction — see
 *      `rowTrustChip`), but the copy now says when we last looked.
 *
 * Takes the job so the caller can't hand it the wrong clock; see
 * `GhostChecked` (types.ts).
 */
export function ghostMetaFor(job: GhostChecked, nowMs: number) {
    const stale = checkFreshness(job, nowMs) === "stale";
    const meta = job.ghost_badge === "clear" && stale ? STALE_CLEAR_META : GHOST_META[job.ghost_badge];
    if (!meta || !stale) return meta;
    return { ...meta, explain: `${meta.explain} ${lastCheckedClause(job.ghost_checked_at, nowMs)}` };
}

/**
 * The dated half of a stale verdict's disclosure. An unknown check date is
 * stated as unknown rather than smoothed into "a while ago" — the one thing
 * this whole change exists to stop is a confident number standing in for a
 * check we can't actually place in time.
 */
function lastCheckedClause(checkedAt: string | null | undefined, nowMs: number): string {
    if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) return "We have no record of when it was last checked.";
    return `Last checked ${formatRelativeAge(checkedAt, nowMs)}.`;
}

/**
 * Exception-only status mark for a role row: `null` for the default,
 * nothing-to-flag state (clear AND currently-checked), otherwise identical
 * to `ghostMetaFor`. Same "the routine state carries no mark" rule the SERP
 * row's `TRUST_CHIP` table already applies to its own `clear`/`checked`
 * icon (app/jobs/page.tsx — a green "no ghost signals" wallpaper on every
 * row was the exact wallpaper that table was built to remove), reused here
 * as a value-level check instead of a second table because /co's two role
 * renderers (CompanyRoleSearch, CompanyRolesList) speak `ghostMetaFor`'s
 * label vocabulary directly, not `RowTrustChip`'s glyph vocabulary.
 *
 * `ghostMetaFor` returns the SAME `GHOST_META.clear` object reference
 * whenever the check is current (no spread/clone happens on that branch —
 * see its own doc), so identity comparison is exactly "clear and fresh"
 * without re-deriving `checkFreshness` a second time here.
 */
export function rowExceptionMeta(job: GhostChecked, nowMs: number) {
    const meta = ghostMetaFor(job, nowMs);
    return meta === GHOST_META.clear ? null : meta;
}

/**
 * Repairs scraped ALL-CAPS / all-lowercase company/location text for public
 * display on the indexable `/jobs/[slug]` page (spec §6.1) — live samples
 * returned `company: "orange"` and `location: "WARSZAWA, POLAND"`, which
 * read as scraped and depress click-through on a page built to be shared.
 * Mixed-case input is left untouched, so deliberate casing ("eBay") survives.
 * Known trade-off: a name that is legitimately ALL-CAPS in its own right
 * (e.g. "IBM") is indistinguishable from scraped shouting and gets re-cased
 * too — there is no signal in a bare string to tell them apart. Presentation-
 * only: callers never write the result back to the stored record.
 */
export function titleCaseDisplay(value: string): string {
    const hasMixedCase = value !== value.toLowerCase() && value !== value.toUpperCase();
    if (hasMixedCase) return value;
    return value.replace(/[\p{L}\p{N}']+/gu, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
}

export function prettyEnum(s: string | null | undefined): string {
    if (!s || s === "unknown") return "";
    return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Decode URL-encoded source data (e.g. "Wisdom%20AI" → "Wisdom AI") safely. */
export function decodeText(s: string | null | undefined): string {
    if (!s) return "";
    if (!s.includes("%")) return s;
    try {
        return decodeURIComponent(s);
    } catch {
        return s.replace(/%20/g, " ");
    }
}

/** Tokenizer shared by `cleanCompany`'s subset check and the relevance-seam
 *  matchers below — lowercase, split on anything that isn't alnum/+/#/.
 *  (keeps "c++" and ".net" intact as single tokens). */
function tokenize(s: string): string[] {
    return s.toLowerCase().split(/[^a-z0-9+#.]+/i).filter(Boolean);
}

/**
 * Company names carry two distinct kinds of upstream noise, cleaned in one
 * pass so both a row and the detail panel see the same result (see the
 * module doc above). Real production examples, retrieved live 2026-07-26:
 *
 *   "QLYS_CA Qualys Canada Ltd."              → "Qualys Canada Ltd."
 *   "STERIS Canada Sales ULC (Canada Sales)"  → "STERIS Canada Sales ULC"
 *   "Ingram Micro Inc. (Canada)"              → unchanged (adds information)
 *   "inog (irish network operators group)"    → unchanged (an expansion)
 *   "The Toronto-Dominion Bank (Canada)"      → unchanged (adds information)
 *
 * Two strips:
 *   1. A leading ATS tenant code — an underscore-joined token of 2+
 *      uppercase/digit segments (e.g. "QLYS_CA", distinct from the older
 *      "USA102"-style req code below) — stripped only when more text follows
 *      it, so a company whose real name IS just a code isn't hollowed out.
 *   2. A trailing parenthetical, but ONLY when its own token set is a SUBSET
 *      of the rest-of-name's tokens — i.e. it's a duplicate, not new
 *      information. "(Canada Sales)" ⊆ {steris, canada, sales, ulc} strips;
 *      "(Canada)" ⊄ {ingram, micro, inc} and "(irish network operators
 *      group)" ⊄ {inog} both keep, because they add a fact the bare name
 *      doesn't already carry.
 */
/**
 * Generic labels a company puts IN FRONT of its own name when it sets up a
 * careers subdomain — "careers.algoleap.com", "jobs.acme.io" — carrying no
 * brand information of their own. Stripped as a leading run (possibly
 * several deep — "careers.jobs.acme" -> "acme") by `humanizeTenantSubdomain`
 * below, never as a suffix or mid-string match, so a company whose own name
 * happens to contain one of these words elsewhere is untouched. Exported so
 * any future subdomain-humanizing code reuses this one list rather than
 * drifting a second copy.
 */
export const GENERIC_SUBDOMAIN_PREFIXES = new Set([
    "www",
    "careers", "career",
    "jobs", "job",
    "apply",
    "hire", "hiring",
    "recruiting", "recruit",
    "talent",
    "work", "workforce",
    "employment",
    "opportunities",
]);

/** Drops a leading run of `GENERIC_SUBDOMAIN_PREFIXES` labels from a
 *  dot-joined token — "careers.jobs.acme" -> "acme". Always leaves at least
 *  one label standing: a token that is ENTIRELY generic words ("careers.jobs")
 *  or has only one label to begin with ("careers") comes back unchanged
 *  rather than stripped to nothing, since an empty/near-empty name is worse
 *  than an imperfect one. */
function stripGenericSubdomainPrefixes(token: string): string {
    const labels = token.split(".");
    let start = 0;
    while (start < labels.length - 1 && GENERIC_SUBDOMAIN_PREFIXES.has(labels[start]!.toLowerCase())) {
        start += 1;
    }
    return labels.slice(start).join(".");
}

/**
 * Extracts clean company brand names from raw ATS tenant domains or domain placeholders:
 * e.g. "zonenetwork.zohorecruit.com" -> "Zone Network"
 *      "sabenzait.zohorecruit.com" -> "Sabenza IT"
 *      "perspire.zohorecruit.com" -> "Perspire"
 *      "acme.workable.com" -> "Acme"
 *      "appmysite.com" -> "Appmysite"
 *      "careers.algoleap" -> "Algoleap" (generic careers-subdomain prefix stripped)
 */
export function humanizeTenantSubdomain(raw: string): string {
    const s = raw.trim();
    if (!s) return "";

    const atsMatch = s.match(/^([a-z0-9-]+)\.(zohorecruit|applicantpro|greenhouse|lever|workday|icims|jobvite|bamboohr|smartrecruiters|recruitee|ashbyhq|breezy|workable)\.(com|io|net|co)$/i);
    let token = atsMatch ? atsMatch[1] : s;

    token = token.replace(/\.(com|io|net|org|co|ai|app|dev|tech)$/i, "");
    // Runs after the TLD strip above so "careers.com" loses its TLD first
    // (-> "careers", a single label the prefix-strip leaves alone) rather
    // than being read as prefix "careers" + bare-TLD remainder "com".
    token = stripGenericSubdomainPrefixes(token);

    if (/[-_]/.test(token)) {
        return token
            .split(/[-_]+/)
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(" ");
    }

    if (token.toLowerCase().endsWith("it") && token.length > 3) {
        const root = token.slice(0, -2);
        return (root.charAt(0).toUpperCase() + root.slice(1).toLowerCase()) + " IT";
    }

    const camelSpaced = token.replace(/([a-z])([A-Z])/g, "$1 $2");
    if (camelSpaced.includes(" ")) {
        return camelSpaced;
    }

    return token.charAt(0).toUpperCase() + token.slice(1);
}

const ATS_PORTAL_HOSTNAME_RE = /\.(applicantpro|greenhouse|lever|workday|icims|jobvite|bamboohr|smartrecruiters|zohorecruit|ashbyhq|recruitee|breezy|workable)\.(com|io|net|co)\b/i;
const BARE_DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

/**
 * True when a raw `company` string isn't real prose asserting a name at
 * all — it's an ATS portal hostname ("acme.workable.com") or a bare domain
 * used as a placeholder ("appmysite.com"), the two shapes `cleanCompany`
 * below routes through `humanizeTenantSubdomain` instead of its normal
 * cleanup. `cleanCompany` still extracts a best-effort display label from
 * these (Defect 1's job: something is better than a raw hostname on
 * screen), but a caller deciding whether the CORPUS actually asserted a name
 * — `resolveCompanyName`'s tally — needs the sharper answer this gives:
 * "no", so it can fall back to the domain-derived label honestly (`source:
 * "domain"`) instead of presenting an extraction guess as corpus evidence.
 * One predicate, two consumers, so they can't disagree about the shape.
 */
export function isCompanyPlaceholder(s: string | null | undefined): boolean {
    const out = decodeText(s).trim();
    if (!out) return false;
    return ATS_PORTAL_HOSTNAME_RE.test(out) || (BARE_DOMAIN_RE.test(out) && !out.includes(" "));
}

/**
 * True when `name` carries no brand information beyond its OWN domain with
 * every separator removed — "phs.org" -> "phsorg" (autosuggest, live prod
 * 2026-08-21: "Phsorg" suggested as a company for a query that happened to
 * start with "phs"). `isCompanyPlaceholder` above catches the SAME defect
 * while the domain's own dots/hyphens still survive in the text
 * ("phs.org" stored verbatim as a company); this catches it once they've
 * already been squashed together, which is why it needs the real domain to
 * compare against rather than working from the name text alone. A caller
 * that confirms this repairs the name via `humanizeTenantSubdomain(domain)`
 * (the same extraction every other ATS-tenant-domain name goes through) or
 * drops the suggestion — never renders the squashed form as-is.
 */
export function isDomainSquashName(name: string, domain: string | null | undefined): boolean {
    if (!domain) return false;
    const squash = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const nameKey = squash(name);
    return nameKey.length > 0 && nameKey === squash(domain);
}

/**
 * True for a posting explicitly tagged internal-only ("[Internal] Developer,
 * Rust", "[INTERNAL ONLY] ..."). Matches a leading bracketed tag that STARTS
 * with "internal" — not the bare word anywhere in the title — so a genuine
 * public role like "Internal Audit Manager" or "International Sales Lead"
 * never matches: neither has a leading `[`, and the second doesn't even
 * word-boundary on "internal". Whatever follows inside the brackets
 * ("[Internal Only]", "[Internal - Do Not Post]") still matches, since the
 * policy question is "was this tagged internal", not "does the tag say
 * exactly one thing".
 */
const INTERNAL_POSTING_RE = /^\s*\[\s*internal\b/i;
export function isInternalPosting(title: string | null | undefined): boolean {
    if (!title) return false;
    return INTERNAL_POSTING_RE.test(title);
}

export function cleanCompany(s: string | null | undefined): string {
    let out = decodeText(s).trim();
    if (!out) return "";

    // ATS portal hostnames or bare domains -> extract humanized tenant name
    if (isCompanyPlaceholder(out)) {
        return humanizeTenantSubdomain(out);
    }

    out = out
        .replace(/^[A-Z]{2,5}\d{2,6}\s+/, "")
        .replace(/^[A-Z0-9]{2,10}_[A-Z0-9]{2,10}\s+(?=\S)/, "")
        .replace(/^[A-Z]{2,6}-\s*/, "")
        .replace(/^C\d{4}\s+/, "")
        .trim();

    const parenMatch = out.match(/\s*\(([^()]+)\)\s*$/);
    if (parenMatch) {
        const rest = out.slice(0, parenMatch.index).trim();
        const restTokens = new Set(tokenize(rest));
        const parenTokens = tokenize(parenMatch[1]);
        if (parenTokens.length > 0 && parenTokens.every((t) => restTokens.has(t))) {
            out = rest;
        }
    }
    return out;
}

/**
 * Display-safe company name: falls back to the humanized domain when `cleanCompany`
 * is empty, so the label never reads "Unknown company" next to a `CompanyLogo`.
 */
export function displayCompany(name: string | null | undefined, domain: string | null | undefined): string {
    const cleaned = cleanCompany(name);
    if (cleaned) return cleaned;
    if (domain) return humanizeTenantSubdomain(domain);
    return "";
}

/**
 * Trailing legal-entity suffixes stripped for `displayCompanyName` below.
 * Distinct from `LEGAL_FORM_TOKENS` in `lib/companies/company-name.ts`, which
 * NEVER renders — it only builds a comparison key so a brand root can be
 * matched against its qualified subsidiaries ("Lumentum" vs "Lumentum Japan,
 * Inc."), and every existing consumer of THAT list (and of `resolveCompanyName`'s
 * `.value`, e.g. "Jabil Inc.") depends on the suffix surviving in what's shown.
 * This list DOES render, so it stays deliberately narrow:
 *   - comma-separated forms always strip ("ServiceTitan, Inc." -> "ServiceTitan")
 *     — the comma is an unambiguous separator, so any recognized legal form
 *     after one is safe to drop.
 *   - the bare, no-comma spelling is riskier — there's no separator, so a
 *     token could be the genuine tail of an unrelated name rather than a
 *     suffix. `stripBareLegalForm` below makes THAT safe as a general
 *     property (the remainder left after stripping must still carry real
 *     brand content) instead of hand-picking which individual tokens are
 *     "safe enough" — so growing `BARE_LEGAL_SUFFIXES` never needs a fresh
 *     ambiguity argument per addition. What still keeps a token OUT of it is
 *     the token's OWN shape: an everyday unpunctuated English word/abbreviation
 *     ("Corp", "Co", "Group") that could plausibly BE a deliberate name
 *     ending stays excluded — "Acme Corp" must read as a company literally
 *     named that. A word that merely CONTAINS one of these tokens is never
 *     touched either way ("Inc Magazine" is untouched — every match here is
 *     end-anchored).
 */
const COMMA_LEGAL_SUFFIXES = [
    "Inc.", "Inc", "L.L.C.", "LLC", "Ltd.", "Corporation", "Corp.", "Co.",
    "GmbH", "S.A.", "Pty Ltd", "PLC",
];
/** Longest phrase first isn't required for correctness (see
 *  `stripBareLegalForm`'s doc comment) but keeps the vocabulary self-
 *  documenting as multi-word forms are added. */
const BARE_LEGAL_SUFFIXES = [
    "Private Limited", "Private Ltd.", "Pvt. Ltd.", "Pvt Ltd", "Pty Ltd", "Pty. Ltd.",
    "Ltd.", "Limited", "L.L.C.", "LLC", "Inc.",
    "GmbH", "PLC", "S.p.A.", "S.A.", "B.V.", "N.V.", "AG", "AB", "Oy",
];
const BARE_LEGAL_SUFFIXES_BY_LENGTH = [...BARE_LEGAL_SUFFIXES].sort((a, b) => b.length - a.length);

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase, punctuation-stripped word — the shared normal form
 *  `BARE_LEGAL_WORDS` and `isOnlyLegalForm` compare on, so "Ltd.", "ltd",
 *  and a stray "L.L.C" missing its final period all read as the same
 *  token regardless of exactly how a source string punctuated it. A
 *  punctuation-only word ("," — what's left of ", Inc." once " Inc." is
 *  cut) normalizes to "", which both callers below treat as chaff too. */
function normalizeLegalWord(w: string): string {
    return w.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Every individual word that appears in ANY `BARE_LEGAL_SUFFIXES` entry
 *  (multi-word phrases split apart) — the vocabulary `isOnlyLegalForm`
 *  checks a stripped remainder's words against. */
const BARE_LEGAL_WORDS = new Set(
    BARE_LEGAL_SUFFIXES.flatMap((f) => f.split(/\s+/)).map(normalizeLegalWord),
);

const COMMA_SUFFIX_RE = new RegExp(`,\\s*(?:${COMMA_LEGAL_SUFFIXES.map(escapeRegExp).join("|")})$`, "i");

/** True when every word of `s` carries no brand identity of its own —
 *  either a recognized legal-form word (`BARE_LEGAL_WORDS`) or pure
 *  punctuation left over from a strip (a lone "," when ", Inc." loses
 *  " Inc."). An empty `s` counts too (nothing real survived). Guards
 *  `stripBareLegalForm` against hollowing a name down to nothing but
 *  suffix chaff. */
function isOnlyLegalForm(s: string): boolean {
    const words = s.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    return words.every((w) => {
        const norm = normalizeLegalWord(w);
        return !norm || BARE_LEGAL_WORDS.has(norm);
    });
}

/**
 * Strips ONE trailing bare (no-comma) legal-form phrase from `s`, trying
 * `BARE_LEGAL_SUFFIXES_BY_LENGTH` longest-first so a multi-word form
 * ("Private Ltd.") strips as a whole unit rather than a shorter member of
 * the same family ("Ltd.") leaving a dangling "...Private" behind. A match
 * only takes effect when the remainder is real brand content — non-empty
 * and not itself `isOnlyLegalForm` — which is what keeps a name that IS
 * just a legal form (or reduces to one after a strip) coming back
 * untouched, and is the general property that makes growing the vocabulary
 * safe by construction rather than by re-deriving safety per token.
 */
function stripBareLegalForm(s: string): string {
    for (const suffix of BARE_LEGAL_SUFFIXES_BY_LENGTH) {
        const re = new RegExp(`\\s+${escapeRegExp(suffix)}$`, "i");
        if (!re.test(s)) continue;
        const remainder = s.replace(re, "").trim();
        if (remainder && !isOnlyLegalForm(remainder)) return remainder;
    }
    return s;
}

/**
 * `cleanCompany`'s output, further stripped of a trailing legal-entity
 * suffix for surfaces that want the brand name alone (`/co/[slug]`'s H1,
 * `<title>`, OG image and JSON-LD — see that page for why they all read from
 * this one function rather than recomputing; also `/jobs`' results row and
 * detail panel via `displayCompanyBrand` below). A companion rather than a
 * change to `cleanCompany` itself: `cleanCompany("Acme Inc.")` already has
 * callers (`resolveCompanyName`'s corpus tally, company-page links/slugs
 * built off a name) that depend on the suffix surviving, so mutating the
 * shared chokepoint would silently change what THEY key or count by. Never
 * strips down to nothing or whitespace — a name that IS just a legal-form
 * word (or empty) is returned as `cleanCompany` left it.
 */
export function displayCompanyName(s: string | null | undefined): string {
    const cleaned = cleanCompany(s);
    if (!cleaned) return cleaned;
    const withoutComma = cleaned.replace(COMMA_SUFFIX_RE, "").trim() || cleaned;
    return stripBareLegalForm(withoutComma);
}

/**
 * `displayCompany`'s domain-fallback pattern (above), but through
 * `displayCompanyName` so a reader sees a brand name rather than a raw legal
 * one. `displayCompany`/`cleanCompany` stay untouched for every caller that
 * needs the un-stripped form — a company-page link/slug built off a name
 * (no domain to key off) or `resolveCompanyName`'s corpus tally both depend
 * on the suffix surviving in what they key or count by.
 */
export function displayCompanyBrand(name: string | null | undefined, domain: string | null | undefined): string {
    const brand = displayCompanyName(name);
    if (brand) return brand;
    if (domain) return humanizeTenantSubdomain(domain);
    return "";
}

/**
 * The corpus's raw `location` strings sometimes hold serialization accidents
 * rather than prose — seen live on production rows 2026-07-26:
 *
 *   `{"country":"Canada","countryCode":"CA","city":"","region":null}`
 *   `[object Object]`
 *
 * Both are upstream sync bugs (an object stringified on its way into the
 * index), but the display layer must never print them regardless of when the
 * corpus is cleaned. Returns readable text, or null when the string carries
 * no human-usable location — the caller then falls through to the structured
 * fields exactly as if `location` were absent.
 */
export function humanizeRawLocation(raw: string): string | null {
    const s = raw.trim();
    if (!s || s === "[object Object]") return null;
    if (s.startsWith("{") || s.startsWith("[")) {
        try {
            const parsed: unknown = JSON.parse(s);
            const values = Array.isArray(parsed) ? parsed : [
                (parsed as Record<string, unknown>).city,
                (parsed as Record<string, unknown>).region,
                (parsed as Record<string, unknown>).state,
                (parsed as Record<string, unknown>).country,
            ];
            const parts = values
                .map((v) => (typeof v === "string" ? v.trim() : ""))
                .filter(Boolean);
            return parts.length ? parts.join(", ") : null;
        } catch {
            // Looks structural but doesn't parse — junk either way.
            return null;
        }
    }
    return s;
}

/** `locationText`'s own "nothing usable came off the posting" sentinel —
 *  exported so callers gating on it (the SERP row's meta line) compare
 *  against the same constant `locationText` returns, rather than a second
 *  copy of the literal string. */
export const LOCATION_UNKNOWN_TEXT = "Location not listed";

export function locationText(j: PublicJob): string {
    if (j.location) {
        const readable = humanizeRawLocation(decodeText(j.location));
        if (readable) {
            if (j.work_type === "remote" && !/\bremote\b/i.test(readable)) {
                return `Remote · ${readable}`;
            }
            return readable;
        }
    }
    // The STRUCTURED fields carry the same accident: the Toolbx doc holds
    // "[object Object]" in `location_city` too (retrieved live 2026-07-26).
    // One junk class, one guard — every field goes through it. A multi-
    // country posting (`location_country` as an array) joins its distinct
    // values into one string BEFORE hitting that same pipeline, so a
    // 2-country posting reads "United States, Canada" like any other joined
    // part rather than needing its own junk-filter pass.
    const country = Array.from(new Set(toValueArray(j.location_country))).join(", ");
    const parts = [j.location_city, j.location_state, country]
        .map((v) => (v ? humanizeRawLocation(decodeText(v)) : null))
        .filter((v): v is string => Boolean(v));
    if (parts.length) {
        const loc = parts.join(", ");
        if (j.work_type === "remote" && !/\bremote\b/i.test(loc)) {
            return `Remote · ${loc}`;
        }
        return loc;
    }
    if (j.work_type === "remote") return "Remote";
    return LOCATION_UNKNOWN_TEXT;
}

/** Split a `locationText` string on ";" into trimmed, non-empty segments.
 *  Aggregator feeds sometimes stuff many locations into one semicolon-joined
 *  `location` string (e.g. "San Diego CA Renewable Group; Remote - AZ;
 *  Remote - AR; ..."), which `humanizeRawLocation` passes through verbatim.
 *  A plain, semicolon-free location returns itself as the sole segment, so
 *  callers can treat every location the same way. */
export function splitLocationSegments(location: string): string[] {
    return location
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
}

/** How many segments the identity-header location line shows before the
 *  "+N more locations" toggle, and how many it hides behind it. */
export interface LocationDisclosure {
    visible: string[];
    hidden: string[];
}

const LOCATION_CLAMP_VISIBLE = 2;
const LOCATION_CLAMP_THRESHOLD = 3;

/** Progressive-disclosure decision for the identity-header location line —
 *  same idiom as the description clamp (`collapsible`/`descExpanded`), just
 *  for semicolon-joined location prose instead of description length. Up to
 *  `LOCATION_CLAMP_THRESHOLD` segments render in full today (no toggle, no
 *  behavior change); more than that clamps to the first
 *  `LOCATION_CLAMP_VISIBLE` with the rest behind the toggle. Pure — no data
 *  loss, the caller decides how `hidden` renders once expanded. */
export function clampLocationSegments(location: string): LocationDisclosure {
    const segments = splitLocationSegments(location);
    if (segments.length <= LOCATION_CLAMP_THRESHOLD) {
        return { visible: segments, hidden: [] };
    }
    return {
        visible: segments.slice(0, LOCATION_CLAMP_VISIBLE),
        hidden: segments.slice(LOCATION_CLAMP_VISIBLE),
    };
}

const SALARY_PERIOD: Record<string, string> = {
    yearly: "yr", year: "yr", annual: "yr", annually: "yr",
    hourly: "hr", hour: "hr", monthly: "mo", month: "mo", weekly: "wk", daily: "day",
};

const ANNUAL_SALARY_PERIODS = new Set(["yearly", "year", "annual", "annually"]);

/** Typical annual comp band — used only to accept scale corrections, not to invent pay. */
const ANNUAL_SALARY_BAND = { min: 25_000, max: 750_000 } as const;

function isAnnualSalaryPeriod(period: string | null | undefined): boolean {
    if (!period) return true;
    return ANNUAL_SALARY_PERIODS.has(period.toLowerCase());
}

/**
 * Correct upstream scale accidents on annual salaries (cents-as-dollars, an
 * extra trailing zero) without touching hourly/monthly values or plausible
 * six-figure comp below the "1560k" absurdity threshold.
 */
export function normalizeSalaryAmount(amount: number, period?: string | null): number {
    if (!Number.isFinite(amount) || amount <= 0 || !isAnnualSalaryPeriod(period)) return amount;

    const inBand = (n: number) => n >= ANNUAL_SALARY_BAND.min && n <= ANNUAL_SALARY_BAND.max;

    if (amount >= 1_000_000 && amount % 100 === 0) {
        const asDollars = amount / 100;
        if (inBand(asDollars)) return asDollars;
    }
    if (amount >= 1_500_000 && amount % 10 === 0) {
        const scaled = amount / 10;
        if (inBand(scaled)) return scaled;
    }
    return amount;
}

function formatSalaryAmount(amount: number): string {
    if (amount >= 1_000_000) {
        const millions = amount / 1_000_000;
        const rounded = Math.round(millions * 10) / 10;
        return Number.isInteger(rounded) ? `${rounded}M` : `${rounded.toFixed(1)}M`;
    }
    return amount >= 1000 ? `${Math.round(amount / 1000)}k` : `${amount}`;
}

export function salaryText(j: PublicJob): string | null {
    if (j.salary_min == null && j.salary_max == null) return null;
    const cur = j.salary_currency ? `${j.salary_currency} ` : "";
    const period = j.salary_period ? SALARY_PERIOD[j.salary_period.toLowerCase()] ?? j.salary_period : "";
    const per = period ? `/${period}` : "";
    const fmt = (n: number) => formatSalaryAmount(normalizeSalaryAmount(n, j.salary_period));
    if (j.salary_min != null && j.salary_max != null) {
        return `${cur}${fmt(j.salary_min)}–${fmt(j.salary_max)}${per}`;
    }
    const one = (j.salary_min ?? j.salary_max) as number;
    return `${cur}${fmt(one)}${per}`;
}

/** Compact "Jul 23"-style date for JobDetail's relisted disclosure sentence —
 *  the one place S2 names a calendar date rather than a relative age.
 *  `timeZone: "UTC"` pins the read to the SAME calendar day the timestamp's
 *  midnight-UTC bits encode, regardless of the viewer's local offset — the
 *  source date is a date-stamp (posted_at, always midnight UTC), not a
 *  local wall-clock moment, so rendering it in the viewer's zone can roll
 *  it back a day (2026-07-08T00:00:00Z read "Jul 7" west of UTC). */
export function shortDate(ms: number): string {
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The ledger row's data-rail age ("today"/"11d ago"/"2mo ago"/"1y ago") —
 * same day/month/year bucketing the row's old sentence-form age used (the
 * ledger redesign replaced that prose line with a right-aligned rail; a full
 * sentence doesn't fit a fixed-width column), just terse enough to sit under
 * a salary figure instead of reading as a clause.
 */
export function postedAgeShort(ts: number | null, now: number): string | null {
    if (ts == null) return null;
    const days = Math.floor((now - ts) / 86_400_000);
    if (days <= 0) return "today";
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(months / 12);
    return `${years}y ago`;
}

/** One segment of the SERP row's meta line — see `buildRowMetaLine`. Salary
 *  renders semibold/foreground; every other segment is muted. */
export interface RowMetaSegment {
    text: string;
    emphasis: boolean;
}

/** Employment-type segment for the row meta line — suppresses the default
 *  "full-time" value the same way the row's old TYPE chip did (only the
 *  exception — contract/part-time/etc. — is worth stating). */
export function employmentTypeSegment(employmentType: string | null | undefined): string | null {
    const pretty = prettyEnum(employmentType);
    if (!pretty) return null;
    const lower = pretty.toLowerCase();
    return lower === "full-time" || lower === "full time" ? null : pretty;
}

/** Appends the onsite/hybrid work mode to an already-known location string.
 *  Remote is skipped: `locationText`'s own "Remote · …" prefix (or bare
 *  "Remote") already carries that fact, so appending it again would repeat
 *  it in the same line. */
export function locationWithMode(location: string, workType: string | null | undefined): string {
    if (workType === "remote") return location;
    const mode = prettyEnum(workType);
    return mode ? `${location} · ${mode}` : location;
}

/**
 * The SERP row's meta line: salary leads (semibold), then whichever of
 * location/employment-type are known, joined "·" in that order — absence is
 * silence, never a placeholder ("pay undisclosed"/"Unknown"). When nothing
 * is known at all, the line falls back to the same posted-age string the
 * row's data rail already shows (`postedAgeShort`) rather than rendering
 * nothing.
 */
export function buildRowMetaLine(
    facts: { salary: string | null; location: string | null; employmentType: string | null },
    postedAge: string | null,
): RowMetaSegment[] {
    const segments: RowMetaSegment[] = [];
    if (facts.salary) segments.push({ text: facts.salary, emphasis: true });
    if (facts.location) segments.push({ text: facts.location, emphasis: false });
    if (facts.employmentType) segments.push({ text: facts.employmentType, emphasis: false });
    if (segments.length > 0) return segments;
    return postedAge ? [{ text: `Posted ${postedAge}`, emphasis: false }] : [];
}

/** How each posted-date window reads out loud. `undefined` is "any time" —
 *  the user explicitly cleared the window, so there is nothing to disclose. */
const POSTED_WINDOW_PHRASE: Record<PostedBucket, string> = {
    "1d": "from the last 24 hours",
    "3d": "from the last 3 days",
    "7d": "from the last 7 days",
    "30d": "from the last 30 days",
    older: "posted more than 30 days ago",
};

/**
 * The single grey line under the pinned search box.
 *
 * Says the posted-date window out loud. A fresh visit already filters to the
 * last 30 days (`DEFAULT_URL_STATE.postedBucket`, url-state.ts), and the
 * redesigned route gives the searcher no control that reveals it — so the
 * number on screen is NOT the size of the corpus. Naming the window converts a
 * hidden filter into a stated fact; without it the count is quietly wrong.
 *
 * Pure: the caller threads its own clock, so this is safe to call from a
 * render body and can be asserted on without a fake timer.
 */
export function searchResultLine(input: {
    count: CorpusCount;
    postedBucket: PostedBucket | undefined;
    /** Corpus sync stamp. Absent when the freshness probe hasn't answered. */
    lastUpdated: string | null | undefined;
    nowMs: number;
}): string {
    const noun = input.count.value === 1 ? "role" : "roles";
    const window = input.postedBucket ? ` ${POSTED_WINDOW_PHRASE[input.postedBucket]}` : "";
    // No stamp yet is not the same as a stale one: say nothing rather than
    // claim a freshness we can't back up. Past `RESULT_LINE_FRESH_MS` (48h)
    // the clause is omitted too, not shown stale — stop confessing
    // staleness inline; a real outage/maintenance window is the degraded
    // banner's job (result-state.ts's `degradedResultsNote`), not this
    // line's (Deliverable 2, 2026-08-01).
    const updated = input.lastUpdated && !isStale(input.lastUpdated, input.nowMs, RESULT_LINE_FRESH_MS)
        ? ` · updated ${formatRelativeAge(input.lastUpdated, input.nowMs)}`
        : "";
    return `${formatCorpusCount(input.count)} ${noun}${window}${updated}`;
}

/**
 * True iff every token of `q` appears as a token in `title` — a startsWith
 * tolerance on each pair lets "manager" match "managers" (title token
 * startsWith query token) without pulling in unrelated titles. Both sides
 * tokenize through the same `tokenize` helper `cleanCompany` uses, so "c++"
 * and ".net" survive as single tokens on either side. An empty query has
 * nothing to require, so it never counts as a match (there's no query left
 * to have "titled" anything).
 */
export function titleMatchesQuery(title: string, q: string): boolean {
    const queryTokens = tokenize(q);
    if (queryTokens.length === 0) return false;
    const titleTokens = tokenize(title);
    return queryTokens.every((qt) => titleTokens.some((tt) => tt.startsWith(qt)));
}

/**
 * The relevance seam (Task A): the index of the first title in `titles` that
 * does NOT match `q` via `titleMatchesQuery` — the boundary between "titled
 * it" and "mentions it" the SERP draws a line under. Returns -1 in every
 * case where there's no seam to draw:
 *   - `q` is empty (nothing was searched, so no title can be said to "titled it")
 *   - `titles` is empty (nothing to seam)
 *   - the seam would land at index 0 (no titled block at all — that's the
 *     widened/relaxed-search note's territory, not this seam's)
 *   - every title matches (no seam needed — the whole page IS the titled block)
 */
export function firstMentionIndex(titles: string[], q: string): number {
    // No special-casing needed for an empty `q`/`titles`: `titleMatchesQuery`
    // already returns false for an empty query (so `findIndex` lands on 0
    // when there's a title to check), and `findIndex` on an empty array is
    // already -1 — both collapse into the same `idx <= 0` branch below.
    const idx = titles.findIndex((t) => !titleMatchesQuery(t, q));
    return idx <= 0 ? -1 : idx;
}

/**
 * `firstMentionIndex`'s "first non-matching title is the seam" trick relies
 * on a prefix property — every titled hit sorted before every non-titled
 * one — that only relevance ranking actually holds. Under an explicit sort
 * (fresh, salary) `sort` acts as a real ORDER BY (see
 * `shouldScopeTextMatchToTitle`, sort.ts) and title/non-title hits interleave
 * by date or pay instead: Meili's typo tolerance admits a near-miss like
 * "Produce Manager" for "product", and it lands wherever ITS date/salary
 * puts it, not after the last real title match. Counting a leading run
 * against interleaved input stops at the first interloper (measured live:
 * 180 of the first 200 hits titled, but the run breaks at index 5).
 *
 * This restores the prefix property by construction instead of counting a
 * run: a stable partition of `hits` into "titled" then "not titled", each
 * half keeping its original relative (sorted) order. Reuses
 * `titleMatchesQuery` — same match rule `firstMentionIndex` uses, so the
 * two never disagree about what counts as "titled it".
 *
 * `seamIndex` mirrors `firstMentionIndex`'s return shape: -1 whenever
 * there's no boundary to draw — empty query, nothing titled (the "no titled
 * block" case), or everything titled (the whole page IS the titled block) —
 * and `hits` comes back in its original order in all three, since nothing
 * moved.
 */
export function partitionByTitleMatch(hits: PublicJob[], q: string): { hits: PublicJob[]; seamIndex: number } {
    if (!q.trim()) return { hits, seamIndex: -1 };
    const titled: PublicJob[] = [];
    const rest: PublicJob[] = [];
    for (const hit of hits) {
        (titleMatchesQuery(decodeText(hit.title), q) ? titled : rest).push(hit);
    }
    if (titled.length === 0 || rest.length === 0) return { hits, seamIndex: -1 };
    return { hits: [...titled, ...rest], seamIndex: titled.length };
}

/**
 * Reorders one fetched batch of hits so no more than `maxRun` consecutive
 * rows share a company — live prod (2026-08-21 audit): 10 straight
 * Extendicare rows, then 7 straight from one other employer, then 3 more,
 * read as a single-company wall rather than a diverse result set. Every hit
 * is kept (no drops). Among companies not currently blocked by the run cap,
 * always takes whichever one's next hit appeared EARLIEST in the original
 * order — so a stretch that's already compliant (no run over `maxRun`) comes
 * out byte-for-byte unchanged instead of being reshuffled for no reason, and
 * only a company actually hitting the cap gets deferred behind a hit from
 * someone else. Falls back to continuing the current company's run only when
 * every other company's hits are already exhausted (unavoidable without
 * dropping something).
 *
 * Applied to each newly-fetched PAGE at the point it's ingested into state
 * (page.tsx), not recomputed over the whole accumulated list on every
 * render — a global re-sort would reshuffle rows the searcher has already
 * seen every time a new page loads.
 */
export function interleaveByCompany(jobs: PublicJob[], maxRun = 2): PublicJob[] {
    // Company key -> original indices of its hits, in original order.
    const groups = new Map<string, number[]>();
    const order: string[] = [];
    jobs.forEach((job, i) => {
        const key = cleanCompany(job.company).trim().toLowerCase() || ` no-company ${i}`;
        const bucket = groups.get(key);
        if (bucket) bucket.push(i);
        else {
            groups.set(key, [i]);
            order.push(key);
        }
    });
    if (order.length <= 1) return jobs;

    const cursor = new Map(order.map((key) => [key, 0]));
    const resultIndices: number[] = [];
    let lastKey: string | null = null;
    let runLength = 0;
    while (resultIndices.length < jobs.length) {
        let picked: string | null = null;
        let pickedFrontIdx = Infinity;
        for (const key of order) {
            const bucket = groups.get(key)!;
            const c = cursor.get(key)!;
            if (c >= bucket.length) continue; // exhausted
            if (key === lastKey && runLength >= maxRun) continue; // blocked
            if (bucket[c]! < pickedFrontIdx) {
                pickedFrontIdx = bucket[c]!;
                picked = key;
            }
        }
        if (picked === null) {
            // Every OTHER company is exhausted — nothing left to interleave
            // the current run with, so it has to continue rather than drop
            // a hit.
            picked = order.find((key) => cursor.get(key)! < groups.get(key)!.length) ?? null;
        }
        if (picked === null) break; // every bucket exhausted — done
        const bucket = groups.get(picked)!;
        const idx = bucket[cursor.get(picked)!]!;
        cursor.set(picked, cursor.get(picked)! + 1);
        resultIndices.push(idx);
        runLength = picked === lastKey ? runLength + 1 : 1;
        lastKey = picked;
    }
    return resultIndices.map((i) => jobs[i]!);
}

/** Shared "role"/"roles" + "is"/"are" agreement for the seam lines below —
 *  one place so the two copy variants can't drift on how they pluralize. */
function titledNounVerb(seamIndex: number): { noun: string; verb: string } {
    return seamIndex === 1 ? { noun: "role", verb: "is" } : { noun: "roles", verb: "are" };
}

/**
 * The seam line's own copy — real counts on both sides of the "titled it" /
 * "mentions it" boundary instead of a static sentence, so the claim stays
 * honest as the result set changes. `seamIndex` (from `firstMentionIndex`) is
 * exactly the titled-block count. `total` is Meili's raw total for the
 * "mentions it" side; it can undercount `hitsLength` in the same pagination
 * edge case `resolveCorpusCount` (corpus-count.ts) exists to guard against —
 * when that happens this falls back to counting the hits actually loaded
 * rather than printing a negative remainder.
 *
 * Relevance ranking only — see `seamSummarySorted` for sorted modes, where
 * `total` can no longer be trusted to mean "more mention it".
 */
export function seamSummary(seamIndex: number, total: number, hitsLength: number): string {
    const remaining = total < seamIndex ? hitsLength - seamIndex : total - seamIndex;
    const n = Math.max(remaining, 0);
    const { noun, verb } = titledNounVerb(seamIndex);
    return `${seamIndex.toLocaleString()} ${noun} ${verb} titled this · ${n.toLocaleString()} more mention it`;
}

/**
 * The seam line's copy for a sorted mode's seam (`partitionByTitleMatch`),
 * where the block below the seam is drawn from the CURRENTLY LOADED page
 * only — most of what's still unloaded further down the sort order is
 * itself titled too (it just ranks lower under fresh/salary than relevance),
 * so `total - seamIndex` is not "more that only mention it" the way it is
 * under `seamSummary`'s relevance ranking. Rather than print a count we
 * can't back up, this names what the partition DOES guarantee: everything
 * visible below the seam, on THIS loaded page, didn't title-match.
 */
export function seamSummarySorted(seamIndex: number): string {
    const { noun, verb } = titledNounVerb(seamIndex);
    return `${seamIndex.toLocaleString()} ${noun} ${verb} titled this · the rest below are weaker matches`;
}
