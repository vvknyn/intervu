import { STATUS_PILL } from "@/lib/ui/status-tokens";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { formatRelativeAge, isStale, RESULT_LINE_FRESH_MS } from "@/lib/jobs/freshness";
import type { GhostBadge, PostedBucket, PublicJob } from "@/lib/jobs/types";
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

// Ghost-badge presentation. Colors route through the shared status-token
// chokepoint (lib/ui/status-tokens.ts): caution/likely_ghost → intv (amber),
// clear → offer (green). Token classes carry both light + dark values, so the
// per-state dark: overrides are no longer needed.
export const GHOST_META: Record<GhostBadge, { label: string; cls: string; dot: string; explain: string } | null> = {
    likely_ghost: {
        label: "Possible ghost job",
        cls: STATUS_PILL.intv,
        dot: "bg-st-intv",
        explain:
            "Subspace's signals flag this posting as a possible ghost job — it may be stale, evergreen, or not actively hiring. Worth verifying before you invest time.",
    },
    caution: {
        label: "Worth verifying",
        cls: STATUS_PILL.intv,
        dot: "bg-st-intv/80",
        explain: "Some signals suggest this posting is worth a quick sanity-check before you apply.",
    },
    clear: {
        label: "No ghost signals",
        cls: STATUS_PILL.offer,
        dot: "bg-st-offer",
        explain: "No ghost-risk signals — this posting looks active.",
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
    dot: "bg-st-intv/60",
    explain: "This posting hasn't been re-checked recently — we can't confirm it's still active. Worth a quick sanity-check before you apply.",
};

/**
 * Single chokepoint for which `GHOST_META` entry a job's row badge AND
 * detail-panel banner render from — so the two surfaces can never disagree
 * about whether a "clear" verdict is still current.
 */
export function ghostMetaFor(ghostBadge: GhostBadge, stale: boolean) {
    return ghostBadge === "clear" && stale ? STALE_CLEAR_META : GHOST_META[ghostBadge];
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
export function cleanCompany(s: string | null | undefined): string {
    let out = decodeText(s).trim();
    if (!out) return "";

    // ATS portal hostnames aren't company names — callers fall back to "Unknown company".
    if (/\.(applicantpro|greenhouse|lever|workday|icims|jobvite|bamboohr|smartrecruiters)\.(com|io|net)\b/i.test(out)) {
        return "";
    }
    // Bare domain used as a company placeholder (e.g. "acme.applicantpro.com").
    if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(out) && !out.includes(" ")) {
        return "";
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
 * Display-safe company name: falls back to the domain when `cleanCompany`
 * blanks a domain-shaped name (e.g. "Super.Com" -> ""), so the label never
 * reads "Unknown company" next to a `CompanyLogo` that's rendering that same
 * domain's favicon. Callers keep their own final "Unknown company" fallback
 * for the case where there's no domain either.
 */
export function displayCompany(name: string | null | undefined, domain: string | null | undefined): string {
    return cleanCompany(name) || (domain ?? "").trim();
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

export function locationText(j: PublicJob): string {
    if (j.location) {
        const readable = humanizeRawLocation(decodeText(j.location));
        if (readable) return readable;
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
    if (parts.length) return parts.join(", ");
    if (j.work_type === "remote") return "Remote";
    return "Location not listed";
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
 * The seam line's own copy — real counts on both sides of the "titled it" /
 * "mentions it" boundary instead of a static sentence, so the claim stays
 * honest as the result set changes. `seamIndex` (from `firstMentionIndex`) is
 * exactly the titled-block count. `total` is Meili's raw total for the
 * "mentions it" side; it can undercount `hitsLength` in the same pagination
 * edge case `resolveCorpusCount` (corpus-count.ts) exists to guard against —
 * when that happens this falls back to counting the hits actually loaded
 * rather than printing a negative remainder.
 */
export function seamSummary(seamIndex: number, total: number, hitsLength: number): string {
    const remaining = total < seamIndex ? hitsLength - seamIndex : total - seamIndex;
    const n = Math.max(remaining, 0);
    const noun = seamIndex === 1 ? "role" : "roles";
    const verb = seamIndex === 1 ? "is" : "are";
    return `${seamIndex.toLocaleString()} ${noun} ${verb} titled this · ${n.toLocaleString()} more mention it`;
}
