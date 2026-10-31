import { ghostBadgeTone, LIVE_PILL, STATUS_PILL } from "@/lib/ui/status-tokens";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { formatRelativeAge, isStale, RESULT_LINE_FRESH_MS } from "@/lib/jobs/freshness";
import { checkFreshness, latestCheckAt } from "@/lib/jobs/badges";
import { classifyCountryValue } from "@/lib/jobs/country-classification";
import type { GhostBadge, GhostChecked, PostedBucket, PublicJob } from "@/lib/jobs/types";
import { toValueArray } from "@/lib/jobs/types";
import { capitalizeWords } from "@/lib/text-case";
import { FUNCTION_WORDS } from "@/lib/geo/common-words";
import { locationEntries, normaliseLocation, placeHasSegment } from "@/lib/presentation/location-normalise";

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
//
// `clear` is carved out of the `ghostBadgeTone`/`STATUS_PILL` lookup: that
// tone scale is tracker PROGRESS (offer routes to `--brand`/blue per the
// Ledger palette ruling), but "actively posted" is a liveness FACT — the
// same claim the result-card check (`text-emerald-700 dark:text-emerald-400`
// above the fold) already makes in green. Borrowing `STATUS_PILL.offer` for
// it made a live-fact pill look like tracker progress; `LIVE_PILL` is the
// one green token both now speak.
const ghostPill = (badge: "clear" | "caution" | "likely_ghost") =>
    badge === "clear" ? LIVE_PILL : STATUS_PILL[ghostBadgeTone(badge)];

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

/** True when the row badge renders `STALE_CLEAR_META` (a "clear" verdict whose check is stale). */
export function isStaleClear(job: GhostChecked, nowMs: number): boolean {
    return job.ghost_badge === "clear" && checkFreshness(job, nowMs) === "stale";
}

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
    const meta = isStaleClear(job, nowMs) ? STALE_CLEAR_META : GHOST_META[job.ghost_badge];
    if (!meta || !stale) return meta;
    return { ...meta, explain: `${meta.explain} ${lastCheckedClause(latestCheckAt(job), nowMs)}` };
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
 * display on the shared `/jobs/[slug]` page (spec §6.1) — live samples
 * returned `company: "orange"` and `location: "WARSZAWA, POLAND"`, which
 * read as scraped and depress click-through on a page built to be shared.
 * Mixed-case input is left untouched, so deliberate casing ("eBay") survives.
 * Known trade-off: a name that is legitimately ALL-CAPS in its own right
 * (e.g. "IBM") is indistinguishable from scraped shouting and gets re-cased
 * too — there is no signal in a bare string to tell them apart. Presentation-
 * only: callers never write the result back to the stored record.
 */
/**
 * Small connectors `titleCaseDisplay` lowercases mid-title — English +
 * French, matched against the corpus's actual language mix (Canadian
 * postings). A connector only lowercases when it actually JOINS two other
 * tokens (see `isConnectorPosition` below): the same word at a title's
 * start, end, or against punctuation ("TORONTO, ON", "PORTLAND, OR -
 * REMOTE") is a trailing code or a leading word, not a connector, and falls
 * through to the length-based rules instead. Deliberately NOT
 * `FUNCTION_WORDS` (lib/geo/common-words.ts): that set exists for search-
 * relevance stopword filtering, is English-only, and is far broader than
 * the small connector class a title actually wants lowercased ("and"/"of"/
 * "the", not "however"/"whereas").
 */
const TITLE_CASE_CONNECTORS = new Set([
    "a", "an", "and", "or", "the", "for", "of", "in", "at", "to", "by", "on", "per",
    "de", "du", "et", "la", "le",
]);

/**
 * A 2-3 letter ALL-CAPS token in a job title or location is overwhelmingly a
 * code (a credential, a state/province abbreviation), not a word shouting —
 * so the default for those lengths is to keep it uppercase. The two lexicons
 * below name the closed set of exceptions: ordinary short words ("NEW",
 * "SAN", "IN") that would otherwise misread as a code. This is a linguistic
 * dictionary, not a tenant/feature gate — it doesn't grow per caller, and a
 * token missing from it still gets a rule-based answer (stays a code), never
 * a fallback to "leave it alone."
 */
const TITLE_CASE_SHORT_WORDS_2 = new Set([
    "am", "as", "be", "do", "go", "if", "is", "jr", "my", "no", "so", "sr", "up", "we",
]);

/** 3-letter ordinary English/French words that read as prose, not an
 *  acronym like "CNC"/"ICU"/"CDL". Also carries every 3-letter member of
 *  `TITLE_CASE_CONNECTORS` ("and", "for", "per", "the"): a 2-letter
 *  connector legitimately doubles as a real code often enough to keep the
 *  code-default when it fails `isConnectorPosition` ("TORONTO, ON" must
 *  stay "ON", not become "On"), but no 3-letter connector is ever a
 *  plausible 3-letter job/location code, so those fall here instead — the
 *  leading "THE" in "THE HOME DEPOT CANADA" is why this matters: it fails
 *  `isConnectorPosition` (no left neighbour) same as "ON" does, but reads as
 *  "The", not "THE". Exported so a test can assert against the exact
 *  dictionary this function reads, rather than a copy of it. */
export const TITLE_CASE_SHORT_WORDS_3: ReadonlySet<string> = new Set(
    [
        "air", "all", "and", "any", "art", "aux", "bar", "bay", "big", "box",
        "bus", "but", "can", "car", "cut", "day", "des", "dry", "due", "end",
        "est", "eye", "far", "fee", "few", "fly", "for", "fun", "gas", "get",
        "gym", "hot", "how", "hub", "ice", "inn", "jet", "job", "key", "kid",
        "kit", "las", "law", "les", "lot", "los", "low", "man", "map", "may",
        "mid", "mix", "net", "new", "non", "not", "now", "off", "oil", "old",
        "one", "our", "out", "own", "pay", "per", "pet", "pit", "pot", "pre",
        "pro", "raw", "red", "row", "run", "san", "saw", "sea", "see", "set",
        "sky", "spa", "sub", "sud", "sun", "sur", "tax", "tea", "the", "tip",
        "top", "toy", "tub", "two", "use", "van", "via", "way", "who",
    ].sort(),
);

/** The inverse dictionary for 4+ letter tokens, which are overwhelmingly
 *  ordinary words by default: a closed set of acronyms that stay shouting
 *  ("HVAC") instead of flattening to a fake word ("Hvac"). */
const TITLE_CASE_KNOWN_ACRONYMS = new Set([
    "apac", "asap", "cctv", "crna", "emea", "fema", "hipaa", "hvac", "latam",
    "nasa", "nicu", "osha", "picu", "pmhnp", "scada", "usmc",
]);

const TITLE_CASE_TOKEN_RE = /[\p{L}\p{N}']+/gu;

/** True only when `matches[i]` sits between two neighbouring tokens with
 *  nothing but whitespace on either side. The first/last token in the
 *  string has no neighbour on one side, and punctuation in the gap (a
 *  comma, a dash, a period) means the token is glued to that punctuation,
 *  not joining two words — "TORONTO, ON" (the original defect) fails on
 *  both counts: ON is the last token, and its left gap is ", ", not pure
 *  whitespace. */
function isConnectorPosition(matches: RegExpMatchArray[], i: number, value: string): boolean {
    if (i === 0 || i === matches.length - 1) return false;
    const prev = matches[i - 1]!;
    const next = matches[i + 1]!;
    const leftGap = value.slice(prev.index! + prev[0].length, matches[i]!.index!);
    const rightGap = value.slice(matches[i]!.index! + matches[i]![0].length, next.index!);
    return /^\s+$/.test(leftGap) && /^\s+$/.test(rightGap);
}

function recaseToken(
    w: string,
    opts: { isConnector: boolean; isAllUpper: boolean; followedByDot: boolean },
): string {
    // An ordinal ("2ND", "21ST") keeps a lower-case suffix.
    if (/^\d+(?:ST|ND|RD|TH)$/.test(w)) return w.toLowerCase();
    // A token carrying a digit ("310T") is a code, not a word — casing
    // rules don't apply, so it passes through exactly as scraped.
    if (/\d/.test(w)) return w;
    const lower = w.toLowerCase();
    const capitalized = lower[0]!.toUpperCase() + lower.slice(1);

    if (opts.isConnector) return lower;
    if (!opts.isAllUpper) return capitalized; // all-lowercase source: capitalize every token

    if (w.length === 1) return w.toUpperCase();
    if (w.length === 2) {
        if (opts.followedByDot) return capitalized; // "ST." -> "St."
        if (TITLE_CASE_SHORT_WORDS_2.has(lower)) return capitalized; // "NO" -> "No"
        return w.toUpperCase(); // code default: "ON", "RN", "IT"
    }
    if (w.length === 3) {
        if (TITLE_CASE_SHORT_WORDS_3.has(lower)) return capitalized; // "NEW" -> "New"
        return w.toUpperCase(); // acronym default: "CNC", "ICU", "CDL"
    }
    if (TITLE_CASE_KNOWN_ACRONYMS.has(lower)) return w.toUpperCase(); // "HVAC"
    return capitalized; // 4+ letters: overwhelmingly a word
}

export function titleCaseDisplay(value: string): string {
    const isAllUpper = value === value.toUpperCase();
    const hasMixedCase = value !== value.toLowerCase() && !isAllUpper;
    if (hasMixedCase) return value;

    const matches = Array.from(value.matchAll(TITLE_CASE_TOKEN_RE));
    let result = "";
    let cursor = 0;
    matches.forEach((m, i) => {
        const w = m[0];
        const start = m.index!;
        result += value.slice(cursor, start);
        result += recaseToken(w, {
            isConnector: TITLE_CASE_CONNECTORS.has(w.toLowerCase()) && isConnectorPosition(matches, i, value),
            isAllUpper,
            followedByDot: value[start + w.length] === ".",
        });
        cursor = start + w.length;
    });
    result += value.slice(cursor);
    return result;
}

export function prettyEnum(s: string | null | undefined): string {
    if (!s || s === "unknown") return "";
    return capitalizeWords(s.replace(/_/g, " "));
}

/**
 * Unicode format characters (category Cf: LRM/RLM, zero-width space, BOM, soft hyphen, ...) render as
 * nothing or as stray marks. Kept: ZWNJ/ZWJ (Persian and Indic shaping, emoji sequences) and the
 * U+E0020-E007F tag characters (emoji subdivision flags), which carry meaning.
 */
const FORMAT_CHAR_RE = /(?![\u200C\u200D\u{E0020}-\u{E007F}])\p{Cf}/gu;

/** `s` without invisible format characters, and, only if some were removed, without the doubled or edge spaces that leaves. */
export function stripFormatChars(s: string): string {
    const out = s.replace(FORMAT_CHAR_RE, "");
    return out === s ? s : out.replace(/\s{2,}/g, " ").trim();
}

/** Decode URL-encoded source data (e.g. "Wisdom%20AI" → "Wisdom AI") safely, and strip invisible format characters. */
export function decodeText(s: string | null | undefined): string {
    if (!s) return "";
    if (!s.includes("%")) return stripFormatChars(s);
    try {
        return stripFormatChars(decodeURIComponent(s));
    } catch {
        return stripFormatChars(s.replace(/%20/g, " "));
    }
}

/**
 * Decodes, trims, and drops blank entries from a raw string-list field —
 * the one chokepoint every "flowing tag line" section (must-have skills,
 * keywords from the posting, ...) filters through before deciding whether
 * it has anything to show. A raw array can pass `.length > 0` while every
 * entry decodes to an empty/whitespace string (garbage or blank source
 * data), which would otherwise render a heading over nothing — callers
 * must gate on THIS result's length, never the raw field's.
 */
export function visibleTags(raw: string[] | null | undefined, limit: number): string[] {
    if (!raw) return [];
    return raw.map(decodeText).map((t) => t.trim()).filter(Boolean).slice(0, limit);
}

/**
 * Skill-list evidence gate — the ONE place display code may read
 * `must_have_skills` / `preferred_skills` off a job. The old extractor
 * fabricated skill values with no signal it had actually found a
 * requirements section; the upstream re-extraction (subspace #3016) stamps
 * `skills_section_found: true` only when it parsed a real
 * Requirements/Preferred heading. Absence of the field means an
 * old, unstamped row — treated as `false`, same as `false` itself: hide.
 * Callers still run the result through `visibleTags` for decode/trim/limit.
 */
export function evidencedSkills(
    job: Pick<PublicJob, "must_have_skills" | "preferred_skills" | "skills_section_found">,
    field: "must_have_skills" | "preferred_skills",
): string[] {
    if (job.skills_section_found !== true) return [];
    return job[field] ?? [];
}

/** Tokenizer shared by `cleanCompany`'s subset check and the relevance-seam
 *  matchers below — lowercase, split on anything that isn't alnum/+/#/.
 *  (keeps "c++" and ".net" intact as single tokens). */
function tokenize(s: string): string[] {
    return s.toLowerCase().split(/[^a-z0-9+#.]+/i).filter(Boolean);
}

/** Set form of `FUNCTION_WORDS` — Meilisearch stop words are a subset. */
const FUNCTION_WORDS_SET: Set<string> = new Set(FUNCTION_WORDS);

/** Normalize `&` to `and` before tokenizing for title-relevance scoring. */
function normalizeAmpersand(s: string): string {
    return s.replace(/&/g, " and ");
}

export function meaningfulTitleTokens(s: string): string[] {
    return tokenize(normalizeAmpersand(s)).filter((t) => !FUNCTION_WORDS_SET.has(t));
}

/**
 * Graded title alignment for relevance reranking: fraction of meaningful query
 * tokens (stopwords stripped via `FUNCTION_WORDS`) matched in the title — a
 * whole word in full, a word the title word only starts with at half
 * (`titleMatchesQuery`'s startsWith rule) — plus up to +0.2 for in-order,
 * compact matches. Score range 0..1.2. Empty/whitespace q or no meaningful
 * query tokens → 0.
 */
export function titleRelevanceScore(title: string, q: string): number {
    const queryTokens = meaningfulTitleTokens(q.trim());
    if (queryTokens.length === 0) return 0;

    const titleTokens = meaningfulTitleTokens(title);
    if (titleTokens.length === 0) return 0;

    // A whole word (or its plural) is a full match; a title word that only
    // STARTS with the query word ("production" for "product", "salesforce"
    // for "sales") counts half, so partly typed words still find titles but
    // a real match always outranks a lookalike (review, 2026-10-13).
    const wholeWord = (tt: string, qt: string) => tt === qt || tt === `${qt}s` || tt === `${qt}es`;
    const matchedTitleIndices: number[] = [];
    let credit = 0;
    for (const qt of queryTokens) {
        const whole = titleTokens.findIndex((tt) => wholeWord(tt, qt));
        const idx = whole >= 0 ? whole : titleTokens.findIndex((tt) => tt.startsWith(qt));
        if (idx >= 0) {
            matchedTitleIndices.push(idx);
            credit += whole >= 0 ? 1 : 0.5;
        }
    }
    if (matchedTitleIndices.length === 0) return 0;

    const coverage = credit / queryTokens.length;

    const inOrder =
        matchedTitleIndices.length >= 2 &&
        matchedTitleIndices.every((idx, i) => i === 0 || idx > matchedTitleIndices[i - 1]);

    let bonus = 0;
    if (inOrder) {
        bonus += 0.1;
        if (matchedTitleIndices.length === queryTokens.length) {
            let gapSum = 0;
            for (let i = 1; i < matchedTitleIndices.length; i++) {
                gapSum += matchedTitleIndices[i] - matchedTitleIndices[i - 1] - 1;
            }
            const maxGap = titleTokens.length - matchedTitleIndices.length;
            bonus += maxGap > 0 ? 0.1 * (1 - gapSum / maxGap) : 0.1;
        }
    }

    return coverage + bonus;
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
 * Drop a trailing hostname label that is TLD-shaped, not a brand.
 *
 * 2–3 letter alphabetic labels are the ccTLD / short-gTLD class (`.us`,
 * `.com`, `.inc`) — always a suffix, never a company name we should keep.
 * 4–8 letter labels (`.club`, `.build`) strip only when the labels to the
 * LEFT are not themselves a generic careers-prefix run: `relay.club` →
 * `relay`, but `jobs.acme` / `talent.zippy` / `careers.algoleap` keep the
 * last label as the brand so prefix-strip can recover it. A leftover
 * multi-label token still fails open to "" below — this does not guess
 * `acme.example` after `.com` is gone.
 */
function stripTrailingTldLabel(token: string): string {
    const labels = token.split(".");
    if (labels.length < 2) return token;
    const last = labels[labels.length - 1]!;
    if (!/^[A-Za-z]+$/.test(last)) return token;
    const n = last.length;
    const head = labels.slice(0, -1);
    if (n === 2 || n === 3) return head.join(".");
    if (n >= 4 && n <= 8) {
        const headIsOnlyGeneric = head.every((l) => GENERIC_SUBDOMAIN_PREFIXES.has(l.toLowerCase()));
        if (!headIsOnlyGeneric) return head.join(".");
    }
    return token;
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

    token = stripTrailingTldLabel(token);
    // Runs after the TLD strip above so "careers.com" loses its TLD first
    // (-> "careers", a single label the prefix-strip leaves alone) rather
    // than being read as prefix "careers" + bare-TLD remainder "com".
    token = stripGenericSubdomainPrefixes(token);

    // A dot surviving here means none of the three brand-identifying signals
    // above (ATS-tenant match, recognized TLD suffix, known generic prefix)
    // resolved this to one label — e.g. "acme.example.com" -> "acme.example":
    // is "acme" a subdomain-brand, or "example" the registrable-domain
    // brand? There's no way to tell. Guessing either presents an unverified
    // name as fact; the raw multi-label remainder itself is just the
    // hostname noise this function exists to strip, capitalized. Return
    // empty rather than a still-dotted, still-hostname-shaped guess.
    if (token.includes(".")) return "";

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

export const ATS_PORTAL_HOSTNAME_RE = /\.(applicantpro|greenhouse|lever|workday|icims|jobvite|bamboohr|smartrecruiters|zohorecruit|ashbyhq|recruitee|breezy|workable|oraclecloud)\.(com|io|net|co)\b/i;
/** False for an ATS or vendor host (the directory's M1 rule): it hosts many employers' boards and is no company's domain. */
export const isCompanyDomain = (domain: string): boolean => !ATS_PORTAL_HOSTNAME_RE.test(domain);
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
        .replace(/^[A-Z0-9]{2,10}(?:_[A-Z0-9]{2,10})+\s+(?=\S)/, "")
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
 *     the token's OWN shape: a pure legal designator that no English brand
 *     chooses as its own deliberate name ending ("Corp", "Corporation",
 *     "Ltd") belongs here even bare — the remainder guard above is
 *     corroboration enough. An ordinary English noun real brands DO choose
 *     to end on ("Co", "Company", "Group", "Holdings") stays excluded —
 *     "Acme Co" must read as a company literally named that — and moves to
 *     `GEO_GATED_TAIL_WORDS` below, gated on an independent corroborating
 *     signal instead. A word that merely CONTAINS one of these tokens is
 *     never touched either way ("Inc Magazine" is untouched — every match
 *     here is end-anchored).
 */
const COMMA_LEGAL_SUFFIXES = [
    "Inc.", "Inc", "L.L.C.", "LLC", "Ltd.", "Corporation", "Corp.", "Co.",
    "GmbH", "S.A.", "Pty Ltd", "PLC",
];
/** Longest phrase first isn't required for correctness (see
 *  `stripBareLegalForm`'s doc comment) but keeps the vocabulary self-
 *  documenting as multi-word forms are added.
 *
 *  Widened 2026-08-21 (prose-company-names): every entry added then is
 *  either punctuated ("Corp.", "Co.", "S.A.S.") or a foreign/technical
 *  abbreviation (ULC, B.V., KK, s.r.o., …) too rare as a genuine everyday
 *  English word to plausibly BE a deliberate brand ending — the same "own
 *  shape" test the module doc above already uses to justify this list.
 *
 *  Widened again 2026-08-29 (a measured /jobs audit: 16.68% of live
 *  postings carried a trailing legal suffix, only 13.42% got cleaned —
 *  "Target Corp" and "NVIDIA Corp" reached the SERP raw because bare
 *  "Corp"/"Corporation"/"Ltd" sat in `GEO_GATED_TAIL_WORDS` waiting for a
 *  geography bracket that never came). Their bare forms move here despite
 *  reading as ordinary English words, because the real test isn't "is this
 *  an everyday word" — it's "does any English brand choose this as its OWN
 *  deliberate name ending". Nothing does for "Corp"/"Corporation"/"Ltd":
 *  they are pure legal designators with no brand-identity use, so the
 *  remainder guard in `stripBareLegalForm` is corroboration enough on its
 *  own, same as the other entries in this list. "Co"/"Company"/"Group" fail
 *  that test — "The Walt Disney Company", "Riverside Group", and the "& Co"
 *  idiom are real, deliberately-chosen brand endings — so they stay in
 *  `GEO_GATED_TAIL_WORDS` below, gated on the independent geography-bracket
 *  signal instead. One known loss from this widening: a single-token brand
 *  that IS its legal designator ("X Corp", the Twitter entity) now renders
 *  as bare "X" — vanishingly rare in a job corpus.
 *
 *  Widened 2026-10-23 with the forms that most often ended a name in the
 *  company-directory evidence (3600 domains) and were still shown: Pte and
 *  Sdn Bhd (Singapore, Malaysia), Ltda (Brazil), S.R.L. and S.L. (Italy,
 *  Romania, Spain), C.V. (Netherlands), a trailing-period "LLC.", K.K. and SA.
 *
 *  Widened 2026-10-24 with the forms the live directory still showed: SE, Sarl, KG, KGaA, OG, the
 *  "GmbH & Co. KG" partnership shapes and "Public Company Limited" (all end-anchored, remainder-guarded). */
const BARE_LEGAL_SUFFIXES = [
    "Private Limited", "Private Ltd.", "Pvt. Ltd.", "Pvt Ltd", "Pty Ltd", "Pty. Ltd.",
    "Ltd.", "Ltd", "Limited", "L.L.C.", "LLC", "LLP", "LP", "Inc.", "Inc", "Incorporated",
    "GmbH", "PLC", "S.p.A.", "SpA", "S.A.", "S.A.S.", "SAS", "B.V.", "BV", "N.V.", "NV",
    "AG", "AB", "Oy", "ULC", "Corp.", "Corp", "Corporation", "Co.", "Pty", "A/S", "KK",
    "s.r.o.", "d.o.o.", "Pte. Ltd.", "Pte Ltd", "Pte.", "Pte", "Sdn. Bhd.", "Sdn Bhd", "Bhd.", "Bhd",
    "LLC.", "Ltda.", "Ltda", "S.R.L.", "SRL", "S.L.", "Lda", "C.V.", "CV", "K.K.", "SA",
    // German-speaking and French forms, and the Thai "Public Company Limited" (its "Limited" strips first);
    // the compound partnerships are whole phrases so the "Co." after "&" is never mistaken for the name.
    "GmbH & Co. KG", "AG & Co. KGaA", "AG & Co. KG", "KGaA", "KG", "OG", "SE", "Sarl", "Public Company Limited",
];
const BARE_LEGAL_SUFFIXES_BY_LENGTH = [...BARE_LEGAL_SUFFIXES].sort((a, b) => b.length - a.length);

/**
 * Bare (unpunctuated) corporate-structure/entity words that real brands DO
 * legitimately choose as their own deliberate name ending — "The Walt
 * Disney Company", "Riverside Group", "The Manufacturers Life Insurance
 * Company", the "& Co" idiom — so on their own they can't safely read as a
 * legal marker the way "Corp"/"Corporation"/"Ltd" can: those moved to
 * `BARE_LEGAL_SUFFIXES` above (2026-08-29) because no English brand chooses
 * one of THOSE as its own ending, only these ordinary nouns. These stay
 * gated: they become safe to strip only once `stackedGeographyParen` finds
 * an independent corroborating signal — a bracketed geography qualifier
 * elsewhere in the name (the "(Canada) Holdings LTD" shape) — because a
 * company that bothers to bracket a subsidiary's geography is naming a
 * legal filing, not styling a brand.
 */
const GEO_GATED_TAIL_WORDS = ["Holdings", "Group", "Co", "Company"];

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

/** Every individual word that appears in ANY `BARE_LEGAL_SUFFIXES` or
 *  `GEO_GATED_TAIL_WORDS` entry (multi-word phrases split apart) — the
 *  vocabulary `isOnlyLegalForm` checks a stripped remainder's words
 *  against. */
const BARE_LEGAL_WORDS = new Set(
    [...BARE_LEGAL_SUFFIXES, ...GEO_GATED_TAIL_WORDS].flatMap((f) => f.split(/\s+/)).map(normalizeLegalWord),
);

const COMMA_SUFFIX_RE = new RegExp(`,\\s*(?:${COMMA_LEGAL_SUFFIXES.map(escapeRegExp).join("|")})$`, "i");

/** True when every word of `s` carries no brand identity of its own —
 *  either a recognized legal-form word (`BARE_LEGAL_WORDS`) or pure
 *  punctuation left over from a strip (a lone "," when ", Inc." loses
 *  " Inc."). An empty `s` counts too (nothing real survived). Guards
 *  `stripBareLegalForm`/`stripOneGeoGatedWord` against hollowing a name
 *  down to nothing but suffix chaff. */
function isOnlyLegalForm(s: string): boolean {
    const words = s.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    return words.every((w) => {
        const norm = normalizeLegalWord(w);
        return !norm || BARE_LEGAL_WORDS.has(norm);
    });
}

/** Matching normal form of one word: lowercase, punctuation dropped except
 *  "/" (so "A/S" never collapses into the ordinary word "as"). */
function normalizeSuffixToken(w: string): string {
    return w.toLowerCase().replace(/[^a-z0-9/]/g, "");
}

/** Each `BARE_LEGAL_SUFFIXES_BY_LENGTH` entry as normalized tokens, split on
 *  whitespace and "." — "Pte. Ltd." and "Pte Ltd" are the same token list. */
const BARE_LEGAL_SUFFIX_TOKENS = BARE_LEGAL_SUFFIXES_BY_LENGTH.map((f) =>
    f.split(/[\s.]+/).map(normalizeSuffixToken).filter(Boolean),
);

/** Words that are a legal form only directly before another legal form
 *  ("Pt Ltd" — a misspelt Pvt/Pte; "P.Ltd" — Private). Alone they are brand
 *  content ("Rapid PT"), so they strip only after a legal form was stripped. */
const COMPOUND_ONLY_LEGAL_WORDS = new Set(["p", "pt"]);

const GEO_GATED_TAIL_TOKENS = new Set(GEO_GATED_TAIL_WORDS.map(normalizeSuffixToken));

/**
 * Strips ONE trailing bare legal-form phrase from `s`, trying
 * `BARE_LEGAL_SUFFIXES_BY_LENGTH` longest-first so a multi-word form
 * ("Private Ltd.") strips as a whole unit rather than a shorter member of
 * the same family ("Ltd.") leaving a dangling "...Private" behind. The
 * trailing words are compared as normalized tokens (case and punctuation
 * ignored, "." and whitespace both separate words), so "Plc.", "P.Ltd" and
 * "Pvt. Ltd" match however a source spaced or punctuated them; an entry that
 * is a lone `GEO_GATED_TAIL_WORDS` member ("Co.") keeps its period as the
 * discriminator, so "Acme Co" stays a company literally named that. A match
 * only takes effect when the remainder is real brand content — non-empty
 * and not itself `isOnlyLegalForm` — which is what keeps a name that IS
 * just a legal form (or reduces to one after a strip) coming back
 * untouched, and is the general property that makes growing the vocabulary
 * safe by construction rather than by re-deriving safety per token. Any
 * `COMPOUND_ONLY_LEGAL_WORDS` left dangling before the stripped form go too.
 */
function stripBareLegalForm(s: string): string {
    /** A word right after "&"/"and" is part of the name ("Smith & Co."), never a suffix. */
    const joinedToName = (at: number) => /(?:&|\band)\s*$/i.test(s.slice(0, at));
    const tokens = [...s.matchAll(/[^\s.]+/g)]
        .map((m) => ({ norm: normalizeSuffixToken(m[0]), start: m.index }))
        .filter((t) => t.norm);
    for (const suffix of BARE_LEGAL_SUFFIX_TOKENS) {
        const first = tokens.length - suffix.length;
        if (first < 1 || !suffix.every((w, i) => tokens[first + i].norm === w)) continue;
        if (joinedToName(tokens[first].start)) continue;
        if (suffix.length === 1 && GEO_GATED_TAIL_TOKENS.has(suffix[0]) && !s.trimEnd().endsWith(".")) continue;
        let keep = first;
        while (keep > 1 && COMPOUND_ONLY_LEGAL_WORDS.has(tokens[keep - 1].norm) && !joinedToName(tokens[keep - 1].start)) keep--;
        for (const end of keep === first ? [first] : [keep, first]) {
            const remainder = s.slice(0, tokens[end].start).replace(/[,\s]+$/, "");
            if (remainder && !isOnlyLegalForm(remainder)) return remainder;
        }
    }
    return s;
}

/** Loops `stripBareLegalForm` to a fixpoint — designators can stack ("Foo
 *  Holdings, LLC" still has an "LLC" to remove after `GEO_GATED_TAIL_WORDS`
 *  strips "Holdings"), and a single pass only ever removes one. */
function stripAllBareLegalForms(s: string): string {
    let out = s;
    while (true) {
        const next = stripBareLegalForm(out);
        if (next === out) return out;
        out = next;
    }
}

/**
 * One pass of `GEO_GATED_TAIL_WORDS` — same shape as `stripBareLegalForm`
 * (comma-tolerant, remainder must survive `isOnlyLegalForm`), plus the
 * additional guard these words need because they're common enough to be a
 * deliberate brand ending on their own: the remainder must stay at least 2
 * tokens or 5 characters, so a short stem doesn't get hollowed out ("Foo
 * Holdings" -> "Foo" is refused; "Michael Kors (Canada) Holdings" ->
 * "Michael Kors (Canada)" is fine). Only called once `stackedGeographyParen`
 * has already found the independent corroborating signal these words need.
 */
function stripOneGeoGatedWord(s: string): string {
    for (const word of GEO_GATED_TAIL_WORDS) {
        const re = new RegExp(`,?\\s+${escapeRegExp(word)}$`, "i");
        if (!re.test(s)) continue;
        const remainder = s.replace(re, "").trim();
        if (!remainder || isOnlyLegalForm(remainder)) continue;
        const tokenCount = remainder.split(/\s+/).filter(Boolean).length;
        if (tokenCount < 2 && remainder.length < 5) continue;
        return remainder;
    }
    return s;
}

/**
 * Finds a bracketed geography qualifier sitting BETWEEN the brand and a
 * legal tail — "(Canada)" in "Michael Kors (Canada) Holdings LTD" — the
 * corroborating signal `GEO_GATED_TAIL_WORDS` and the geography-parenthetical
 * strip in `stripLegalTail` both gate on. Reuses `classifyCountryValue`
 * (country-classification.ts, the repo's one country-name/alias table) —
 * one source of truth for "is this a country" instead of a second,
 * hand-rolled geography word list — so "Canada", "US", "UK" and every other
 * alias it already recognizes work here for free.
 *
 * Deliberately requires something to still follow the closing paren: a
 * parenthetical that is ALREADY the last thing in the name — "Ingram Micro
 * Inc. (Canada)" — is `cleanCompany`'s own "does this add information"
 * territory (module doc above), which already decided to KEEP it; this
 * function only fires on the "geography sits between the brand and a legal
 * tail" shape, never the "trailing geography is the whole story" shape.
 *
 * Only a BRACKETED geography token counts — never a bare one. "Stryker
 * Canada ULC" strips to "Stryker Canada", not "Stryker": an unbracketed
 * country word is load-bearing in real brand names ("Air Canada", "Canada
 * Goose"), where a company that specifically brackets it is reliably
 * marking a subsidiary rather than naming itself.
 */
function stackedGeographyParen(s: string): { content: string } | null {
    const re = /\(([^()]{1,40})\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
        const content = m[1]!.trim();
        if (content.split(/\s+/).filter(Boolean).length > 3) continue;
        if (classifyCountryValue(content).kind !== "country") continue;
        const afterParen = s.slice(m.index + m[0].length);
        if (!afterParen.trim()) continue; // already trailing — cleanCompany's call, not this one's
        return { content };
    }
    return null;
}

/**
 * `displayCompanyName`'s prose-safety pass, one level past
 * `stripAllBareLegalForms`: a `^Company \d+ - ` upstream row-index prefix
 * (a known source defect, same class as `cleanCompany`'s own leading
 * req/tenant-code strips — kept in this display-only layer rather than
 * `cleanCompany` itself, see `displayCompanyName`'s doc below for why), the
 * geography-gated bare words `GEO_GATED_TAIL_WORDS` above, and the
 * geography parenthetical they can newly expose. Order: prefix, then
 * designators/geo-gated words to a fixpoint (stacking — "Holdings LTD" is
 * two strips), then the now-possibly-exposed geography parenthetical. A
 * final safety net (never below 2 chars, never JUST legal-form chaff) falls
 * back to the pre-strip string rather than risk a mangled fragment —
 * belt-and-braces on top of the per-step remainder guards, which should
 * already make this unreachable.
 */
function stripLegalTail(s: string): string {
    const prefixStripped = s.replace(/^Company\s+\d+\s*-\s*/i, "");
    const geo = stackedGeographyParen(prefixStripped);

    let out = prefixStripped;
    while (true) {
        const next = stripAllBareLegalForms(out);
        if (next !== out) {
            out = next;
            continue;
        }
        if (geo) {
            const gated = stripOneGeoGatedWord(out);
            if (gated !== out) {
                out = gated;
                continue;
            }
        }
        break;
    }

    if (geo) {
        const trailingGeoRe = new RegExp(`,?\\s*\\(${escapeRegExp(geo.content)}\\)\\s*$`, "i");
        if (trailingGeoRe.test(out)) out = out.replace(trailingGeoRe, "").trim();
    }

    if (out.length < 2 || isOnlyLegalForm(out)) return prefixStripped;
    return out;
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
 *
 * `stripLegalTail` (prose-company-names, 2026-08-21) is the same kind of
 * companion, one step further: "(Canada) Holdings LTD"-shaped legal filings
 * are still `cleanCompany("Acme Inc.")`'s exact problem — a call-site audit
 * found `resolveCompanyName` (company-name.ts) reads `cleanCompany`'s output
 * as a matching/dedup/tally key, so composing the wider strip there too
 * would silently change which corpus row wins a company's display name,
 * not just how it renders. It composes here instead, where every consumer
 * (this function's own callers, `displayCompanyBrand`) is display-only.
 */
/** One trailing parenthetical ("(Malaysia)"): chaff once it follows a legal form, which `displayCompanyName` strips. */
const TRAILING_PAREN_RE = /\s*\([^()]+\)$/;

export function displayCompanyName(s: string | null | undefined): string {
    const cleaned = cleanCompany(s);
    if (!cleaned) return cleaned;
    const beforeParen = cleaned.replace(TRAILING_PAREN_RE, "").trim();
    const unparenthesized = beforeParen && stripBareLegalForm(beforeParen) !== beforeParen ? beforeParen : cleaned;
    const withoutComma = unparenthesized.replace(COMMA_SUFFIX_RE, "").trim() || unparenthesized;
    return stripLegalTail(withoutComma);
}

/** Split a display company name on spaced dash/em-dash separators only —
 *  hyphens inside words ("Toronto-Dominion") stay intact. */
const COMPANY_SEGMENT_SPLIT_RE = /\s+[–—|-]\s+/;

function squashBrandKey(s: string): string {
    return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitCompanyDisplaySegments(name: string): string[] {
    return name.split(COMPANY_SEGMENT_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
}

/** True when a segment looks like an ATS slogan/team line echoed in the title
 *  rather than a company name — 4+ words or length ≥ 20, and a case-
 *  insensitive substring of `title`. */
function isTitleEchoSegment(segment: string, title: string | null | undefined): boolean {
    if (!title) return false;
    const decodedTitle = decodeText(title);
    if (!decodedTitle) return false;
    const wordCount = segment.split(/\s+/).filter(Boolean).length;
    if (wordCount < 4 && segment.length < 20) return false;
    return decodedTitle.toLowerCase().includes(segment.toLowerCase());
}

/**
 * Prefer the brand tail of `{slogan} - {brand}` ATS company strings when an
 * independent signal confirms the tail: domain-brand equality (squash of last
 * segment vs squash of `humanizeTenantSubdomain(domain)`) or title-echo drop
 * of slogan segments. Composes on `displayCompanyName` output — never on raw
 * corpus names — so legal-suffix stripping still runs first.
 */
export function preferBrandSegment(
    name: string,
    domain: string | null | undefined,
    title?: string | null,
): string {
    const segments = splitCompanyDisplaySegments(name);
    if (segments.length <= 1) return name;

    const lastSegment = segments[segments.length - 1]!;
    if (domain) {
        const domainBrand = humanizeTenantSubdomain(domain);
        if (domainBrand && squashBrandKey(lastSegment) === squashBrandKey(domainBrand)) {
            return lastSegment;
        }
    }

    const kept = segments.filter((s) => !isTitleEchoSegment(s, title));
    if (kept.length === 0 || kept.length === segments.length) return name;
    if (kept.length === 1) return kept[0]!;
    return kept.join(" - ");
}

/**
 * `displayCompany`'s domain-fallback pattern (above), but through
 * `displayCompanyName` so a reader sees a brand name rather than a raw legal
 * one. `displayCompany`/`cleanCompany` stay untouched for every caller that
 * needs the un-stripped form — a company-page link/slug built off a name
 * (no domain to key off) or `resolveCompanyName`'s corpus tally both depend
 * on the suffix surviving in what they key or count by.
 */
export function displayCompanyBrand(
    name: string | null | undefined,
    domain: string | null | undefined,
    title?: string | null,
): string {
    const brand = displayCompanyName(name);
    if (!brand) {
        if (domain) return titleCaseDisplay(humanizeTenantSubdomain(domain));
        return "";
    }
    return titleCaseDisplay(preferBrandSegment(brand, domain, title));
}

const STRINGIFIED_OBJECT = "[object Object]";

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
    // A stringified object can also arrive as ONE comma segment of a
    // readable location ("Amsterdam, NH,NL, [object Object]") — drop it
    // wherever it sits, keep the rest.
    const s = (raw.includes(STRINGIFIED_OBJECT)
        ? raw.split(",").filter((part) => part.trim() !== STRINGIFIED_OBJECT).join(",")
        : raw
    ).trim();
    if (!s) return null;
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

// Address-vocabulary lexicons `classifyLocationPart` matches whole-word
// (via `hasWord`) — a linguistic dictionary, not a per-tenant/spelling
// special case, so a new language just adds entries here.
const STREET_WORDS = new Set([
    // en
    "street", "st", "ave", "avenue", "blvd", "boulevard", "road", "rd", "drive", "dr",
    "lane", "ln", "way", "court", "ct", "place", "pl", "highway", "hwy", "parkway", "pkwy",
    "route", "rte", "circle", "cir", "terrace", "ter", "trail", "trl", "plaza", "square", "sq", "loop",
    // fr
    "rue", "chemin", "allée", "allee", "impasse", "quai", "cours",
    // es/pt
    "calle", "carrera", "avenida", "av", "paseo", "rua", "praça", "praca",
    // it
    "via", "viale", "piazza", "corso",
    // de
    "straße", "strasse", "str", "platz", "weg", "gasse", "ring",
    // nl
    "straat", "laan", "plein", "gracht",
]);

const UNIT_WORDS = new Set([
    "suite", "ste", "unit", "floor", "fl", "bldg", "building", "apt", "apartment", "level", "po", "box", "#",
]);

/** Whole-word, case-insensitive membership test against a lexicon Set —
 *  splits on the same punctuation a location part is ever glued together
 *  with, so "21st Floor" matches "floor" but "Broadway" never false-matches
 *  "way" mid-word, and a real place named "Trail" or "Terrace" never
 *  false-matches the street-suffix reading of its own name. */
function hasWord(part: string, words: ReadonlySet<string>): boolean {
    return part
        .toLowerCase()
        .split(/[\s\-.,]+/)
        .some((token) => words.has(token));
}

/** Leading number token: a digit run optionally followed by an ordinal
 *  suffix or a single letter, ending at a word boundary. Captures the digit
 *  run alone so callers can read its length without the suffix. */
const NUM_RE = /^(\d+)(?:st|nd|rd|th|[A-Za-z])?(?=[\s-]|$)/i;

/** A unit/suite marker immediately followed by its own number — "Suite
 *  200", "Floor 2", "Bldg 5", "PO Box 12". Deliberately excludes the
 *  2-letter entries in `UNIT_WORDS` ("fl"): those collide with
 *  state/province codes ("FL"), and a 2-letter code followed by a long
 *  digit run is a postal code riding along the state ("FL 33602"), not a
 *  floor number — `stripEmbeddedNoise` strips that digit run on its own,
 *  leaving the code. */
const UNIT_NUMBER_RE = /^(suite|ste|unit|floor|bldg|building|apt|apartment|level|po\s*box|p\.o\.\s*box)\.?\s*(?:#\s*)?\S*\d/i;
const BARE_HASH_NUMBER_RE = /^#\s*\d/;

/** A trailing house-number token — "10", "5", "3B" — glued onto the end of
 *  a street-name-first part ("Via Roma 10", "Musterstraße 5"). */
const HOUSE_NUMBER_SUFFIX_RE = /\s\d+[A-Za-z]?$/;

/** Same lexicon as `hasWord`, plus a suffix match against the 4+ letter
 *  entries: IT/ES/FR street words are their own token ("Via Roma"), but
 *  DE/NL compound the street suffix directly onto the name with no
 *  separator ("Musterstraße", "Bahnhofplein") — a whole-word split alone
 *  never sees those. The length floor excludes the 2-3 letter abbreviation
 *  entries (st, dr, rd, ln, pl, ct, av, sq, ring, …), which are only
 *  meaningful as their own token; matching those as a bare suffix would
 *  false-positive on ordinary words that happen to end the same way. */
function endsWithStreetWord(part: string): boolean {
    const suffixWords = [...STREET_WORDS].filter((w) => w.length >= 4);
    return part
        .toLowerCase()
        .split(/[\s\-.,]+/)
        .some((token) => STREET_WORDS.has(token) || suffixWords.some((w) => token.endsWith(w)));
}

/**
 * Classifies one comma/underscore-split location part for
 * `stripStreetAddress`: `"drop"` when the part is street-address noise with
 * nothing worth keeping, `"keep"` when it's untouched prose, or
 * `{ keep }` when it's a postcode+city part that keeps its city with the
 * leading digits removed. `STREET_WORDS` is consulted inside a numbered
 * part (case 2, number-first: "100 Broadway") and, via `endsWithStreetWord`,
 * on an un-numbered part that ends with a house number (case 2', name-first:
 * "Via Roma 10") — never on a part with neither signal, so real places named
 * Trail, Terrace, Circle Pines, Plaza, or Dublin (postal district "2") keep
 * working.
 */
function classifyLocationPart(part: string): "keep" | "drop" | { keep: string } {
    if (/^\d+$/.test(part)) return "drop";

    const numMatch = part.match(NUM_RE);
    if (numMatch) {
        if (hasWord(part, STREET_WORDS) || hasWord(part, UNIT_WORDS)) return "drop";
        const digits = numMatch[1]!;
        if (digits.length >= 4) {
            const rest = part.slice(numMatch[0].length).replace(/^[\s-]+/, "");
            return { keep: rest.replace(/^[A-Z]{2}\s+(?=\S)/, "") };
        }
        return "drop";
    }

    // Rule 2': street-name-first addresses (IT/ES/DE/FR/NL) put the house
    // number at the END instead of the start. Both signals are required —
    // a street word alone would drop a real place whose name happens to
    // carry one ("Trail, BC"), and a trailing number alone would drop a
    // genuine place+number ("Dublin 2").
    if (HOUSE_NUMBER_SUFFIX_RE.test(part) && endsWithStreetWord(part)) return "drop";

    if (UNIT_NUMBER_RE.test(part) || BARE_HASH_NUMBER_RE.test(part)) return "drop";

    return "keep";
}

// Postal-code SHAPES worth stripping out of a surviving part (e.g. "ON N0N
// 1G0" -> "ON") — same shape classes `locationSummary` (lib/presentation/
// location.ts) matches as a whole segment, here matched as a substring
// since a street-address part often carries the code glued to a state/
// province abbreviation rather than as its own comma segment.
const STREET_CA_POSTAL_RE = /\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b/g;
const STREET_US_POSTAL_RE = /\b\d{5}(?:-\d{4})?\b/g;
const STREET_UK_POSTAL_RE = /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g;
const STREET_NL_POSTAL_RE = /\b\d{4} ?[A-Z]{2}\b/g;

// A bare numeric code dash-joined onto the end of a part (e.g. "Atlanta -
// 9141", a retailer's own store number) — the same "junk digits" class
// `classifyLocationPart`'s rule 1 drops when the number is its own comma
// segment, here glued on with a dash instead. Anchored to a run of ALL
// digits at the end so it never eats a real dash-joined place qualifier
// ("Remote - AZ", "Remote - EMEA"), which is letters, not digits.
const STREET_TRAILING_DASH_NUMBER_RE = /\s+-\s+\d+$/;

function stripEmbeddedNoise(part: string): string {
    return part
        .replace(STREET_CA_POSTAL_RE, "")
        .replace(STREET_US_POSTAL_RE, "")
        .replace(STREET_UK_POSTAL_RE, "")
        .replace(STREET_NL_POSTAL_RE, "")
        .replace(STREET_TRAILING_DASH_NUMBER_RE, "")
        .replace(/^[\s,.-]+|[\s,.-]+$/g, "");
}

/**
 * Strips street-address components (house number + street, suite/unit,
 * postal code) out of a location string so a single mailing address stops
 * masquerading as several distinct locations downstream — `locationSummary`
 * reads a comma-joined string as an ATS breadcrumb, so a full street
 * address ("626 Polymoore Drive, Corunna, ON N0N 1G0, Canada") reads as 4
 * "locations" and prints "626 Polymoore Drive +3 more" instead of a place.
 *
 * Pattern-based, not a place-name lookup: splits on commas (or underscores —
 * some feeds join parts "MEX_Santa Catarina_Nuevo León_206 Canada" instead
 * of with a comma; same parts, same rule, just a different glue character),
 * classifies each part (`classifyLocationPart`) as street-address noise to
 * drop (a house number, a bare number, a unit/suite marker), a postcode+city
 * part to keep with its digits removed, or plain prose to keep untouched,
 * then strips an embedded postal code — or a dash-joined trailing
 * store/building number ("Atlanta - 9141") — out of whatever survives.
 * `;`-joined multi-location strings (aggregator feeds stuffing several
 * roles' worth of locations into one field) are handled per-segment so
 * "Remote Canada; Remote USA" is untouched. Returns "" when nothing
 * survives a part — the caller (`locationText`) falls through to the
 * structured city/state/country fields rather than trusting an invented
 * value.
 */
export function stripStreetAddress(raw: string): string {
    return raw
        .split(";")
        .map((locationPart) =>
            locationPart
                .split(/[,_]/)
                .map((part) => part.trim())
                .filter(Boolean)
                .map((part) => {
                    const verdict = classifyLocationPart(part);
                    if (verdict === "drop") return "";
                    return verdict === "keep" ? part : verdict.keep;
                })
                .filter(Boolean)
                .map(stripEmbeddedNoise)
                .filter(Boolean)
                .join(", "),
        )
        .filter(Boolean)
        .join("; ");
}

/** `locationText`'s own "nothing usable came off the posting" sentinel —
 *  exported so callers gating on it (the SERP row's meta line) compare
 *  against the same constant `locationText` returns, rather than a second
 *  copy of the literal string. */
export const LOCATION_UNKNOWN_TEXT = "Location not listed";

/** "City, Region, Country" from the resolved geo fields alone; "" when they
 *  carry nothing usable. */
export function structuredLocationText(j: PublicJob): string {
    // The STRUCTURED fields carry the same accident: the Toolbx doc holds
    // "[object Object]" in `location_city` too (retrieved live 2026-07-26).
    // One junk class, one guard — every field goes through it. A multi-
    // country posting (`location_country` as an array) joins its distinct
    // values into one string BEFORE hitting that same pipeline, so a
    // 2-country posting reads "United States, Canada" like any other joined
    // part rather than needing its own junk-filter pass. Each field also
    // gets the same street-address strip as `locationText`'s raw branch — a
    // scraped `location_city` can carry the same house-number/unit noise.
    const country = Array.from(new Set(toValueArray(j.location_country))).join(", ");
    const parts = [j.location_city, j.location_state, country]
        .map((v) => (v ? stripStreetAddress(humanizeRawLocation(decodeText(v)) ?? "") : ""))
        .filter(Boolean);
    const fromFields = normaliseLocation(parts.join(", "));
    return fromFields ? titleCaseDisplay(fromFields) : "";
}

export function locationText(j: PublicJob): string {
    if (j.location) {
        const readable = humanizeRawLocation(decodeText(j.location));
        // Street-address components (house number, unit, postal code)
        // stripped so a mailing address never masquerades as the place.
        // Nothing surviving the strip (e.g. a bare street address with no
        // city) falls through to the structured fields below rather than
        // returning the still-address-shaped raw string. Work mode is NOT
        // prefixed here — every caller that renders this string also
        // renders `work_type` as its own chip/fact adjacent to it, so a
        // remote job wouldn't just repeat the word, it'd repeat it right
        // next to itself ("📍 Remote · Milan, Italy · Remote · Full Time").
        // Then `normaliseLocation` (ATS boilerplate, glued/duplicate segments)
        // — nothing real surviving it falls through the same way.
        const stripped = readable ? normaliseLocation(stripStreetAddress(readable)) : "";
        if (stripped) {
            return titleCaseDisplay(stripped);
        }
    }
    return structuredLocationText(j) || (j.work_type === "remote" ? "Remote" : LOCATION_UNKNOWN_TEXT);
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
    const segments = locationEntries(location);
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

export function isAnnualSalaryPeriod(period: string | null | undefined): boolean {
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

export function formatSalaryAmount(amount: number): string {
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
        const min = fmt(j.salary_min);
        const max = fmt(j.salary_max);
        if (min === max) return `${cur}${min}${per}`;
        return `${cur}${min}–${max}${per}`;
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
    return workType === "remote" ? location : placeWithWorkMode(location, workType);
}

/**
 * Same work-mode token the SERP row's fact-chip row renders
 * (`buildFactChips`' work_type chip label, which is just `prettyEnum`),
 * folded onto an already-computed place string as its own " · Mode"
 * segment — for the surfaces that render `locationText` with no adjacent
 * work-mode chip of their own (`RelatedJobRow`, `FollowAlertsDialog`, the
 * digest email) and so lost their only remote/hybrid signal once
 * `locationText` stopped prefixing "Remote ·" onto the place text. Skipped
 * when the mode token already IS the place text — `locationText`'s own
 * no-structured-location fallback returns the bare word "Remote", and
 * appending the same word again would repeat it on one line, exactly the
 * defect `locationText`'s prefix removal fixed elsewhere.
 */
export function placeWithWorkMode(place: string, workType: string | null | undefined): string {
    const mode = prettyEnum(workType);
    const clean = normaliseLocation(place);
    if (!mode || placeHasSegment(clean, mode)) return clean;
    return clean ? `${clean} · ${mode}` : mode;
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
    "90d": "from the last 90 days",
    older: "posted more than 90 days ago",
};

/**
 * The single grey line under the pinned search box.
 *
 * Says the posted-date window out loud. A fresh visit already filters to the
 * last 90 days (`DEFAULT_URL_STATE.postedBucket`, url-state.ts), and the
 * redesigned route gives the searcher no control that reveals it — so the
 * number on screen is NOT the size of the corpus. Naming the window converts a
 * hidden filter into a stated fact; without it the count is quietly wrong.
 *
 * `lastUpdated` is expected to already be MAX(updated_at) over the SAME
 * filtered population `count` describes — the caller (`getJobsFreshnessAction`,
 * fed the exact same `buildJobSearchPayload` output as the results search)
 * is what makes that true, not this function. A single employer's 7 listings
 * can each be 3 months stale while the whole corpus synced 40 minutes ago —
 * this function has no way to tell the two apart, so it trusts its input.
 *
 * Pure: the caller threads its own clock, so this is safe to call from a
 * render body and can be asserted on without a fake timer.
 */
export function searchResultLine(input: {
    count: CorpusCount;
    postedBucket: PostedBucket | undefined;
    /** Stamp for the population `count` describes. Absent when the
     *  freshness probe hasn't answered (or has none to give — see
     *  `fetchJobsLastUpdated`, meilisearch.ts). */
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
 * The results list's one live-count line (page.tsx's `liveCountEl`, rendered
 * once at the end of the list rather than duplicated in the masthead — the
 * front door shows a single number, not two that can disagree) — reads
 * `null` when the marketing stats probe came back empty
 * (`getMarketingStatsAction`), so the caller can omit the whole line rather
 * than render a stale or fabricated number.
 *
 * Honesty fix (intervu first-screen audit): this count
 * (`getCachedMarketTrends().liveJobs`, market-trends.ts) is
 * `vacancy_status = "active"` with NO posted-date filter at all, while the
 * result line just above it in the search well
 * (`searchResultLine`) defaulted to the last 30 days (90 since 2026-09-30) — so the masthead used to
 * show "2,339,946 live roles" beside "111,151 roles from the last 30 days"
 * with nothing explaining the ~21x gap. The two counts are NOT a clean
 * subset/superset pair (this one's `active`-only; the result line's
 * `!= "closed"` also includes the `unknown` status — see `LIVE_VACANCY_FILTER`
 *'s own comment, meilisearch.ts), so the fix does not claim one literally
 * contains the other. What IS literally true of every count this function
 * renders: it applies no date window. Naming that ("all posting dates") gives
 * this line its own stated scope, parallel to the result line's "from the
 * last 90 days" — deliberately not "all-time", which already names a
 * DIFFERENT metric (`totalTracked`, market-trends.ts) and would collide
 * with it.
 */
export function liveCountLine(count: CorpusCount | null): string | null {
    if (count === null) return null;
    return `${formatCorpusCount(count)} live roles tracked, all posting dates`;
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
 * The tier-1/tier-2 seam for a federated tiered-retrieval result
 * (`runTieredRetrieval`, meilisearch.ts) — placed from each hit's OWN `tier`
 * (per-hit provenance) rather than a carried count like `tier1Total`. A
 * count is an absolute index into the UNFILTERED pool; `hits` here may
 * already have passed through a client-side filter (e.g. "hide viewed"), so
 * indexing by that count lands on the wrong row the moment a filter removes
 * any row ahead of the seam. Walking `hits` for the first `tier === 2` entry
 * is correct regardless of what was filtered out ahead of it.
 *
 * Returns `null` when `hits` carries no tier at all — the non-federated
 * mechanism — telling the caller to fall back to `firstMentionIndex`/
 * `partitionByTitleMatch` instead. Returns `-1` for a tiered result with no
 * tier-2 hit (every hit is tier 1 — nothing to seam). Returns `0` when the
 * very FIRST hit is already tier 2 (a filtered/paged list can start entirely
 * inside tier 2) — callers must render that as a real seam, not treat it as
 * falsy/no-seam the way `-1` is.
 */
export function tieredSeamIndex(hits: PublicJob[]): number | null {
    if (!hits.some((h) => h.tier !== undefined)) return null;
    return hits.findIndex((h) => h.tier === 2);
}

/**
 * The one flip point for "what number is the headline total" — shared by
 * `/jobs`'s displayed count and `/api/jobs/count`'s `total` field so the
 * union-vs-strict ruling can never drift between the two callers. Which
 * number wins is `policy`, defaulting to the module constant
 * `HEADLINE_POLICY`: `"union"` returns `input.total` — for a tiered-retrieval
 * result (`tier1Total` present — see `runTieredRetrieval`, meilisearch.ts)
 * that's the whole-document pool's own `estimatedTotalHits` (a federated
 * union, not a client-side sum); `"titled"` returns `input.tier1Total`
 * instead, when it's present, falling back to `input.total` when it isn't
 * (every non-tiered path, where there is no strict-only count to prefer).
 * `HEADLINE_POLICY` is `"union"` today — the old bug was reporting the
 * strict-scope count as if it were the whole corpus, and union is the
 * corrected reading — pending a product ruling on whether the headline
 * should instead reflect only the strict-scope count.
 */
export const HEADLINE_POLICY: "union" | "titled" = "union";

export function resolveHeadlineTotal(
    input: { total: number; tier1Total?: number },
    policy: "union" | "titled" = HEADLINE_POLICY,
): number {
    return policy === "titled" && typeof input.tier1Total === "number" ? input.tier1Total : input.total;
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
