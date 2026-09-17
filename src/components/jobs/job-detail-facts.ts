import { formatRelativeAge } from "@/lib/jobs/freshness";
import { locationText, prettyEnum, salaryText } from "@/lib/jobs/presentation";
import type { PostingFreshness } from "@/lib/jobs/posting-freshness";
import type { GhostChecked, PublicJob } from "@/lib/jobs/types";
import type { TrackRecord } from "@/lib/companies/aggregates";
import { formatCount } from "@/lib/format";

/**
 * Pure data→chips mapping for JobDetail's structured facts row (2026-08-01
 * facts-row deliverable). Split out of the component so the "which chips
 * exist for this job" decision is unit-testable without a DOM — JobDetail
 * only owns turning a `FactChip[]` into JSX (icon lookup + layout).
 *
 * `posted`/`first_seen` reuse the SAME relative-age strings JobDetail
 * already derives from `classifyPostingFreshness` (posting-freshness.ts)
 * rather than re-deriving date math here — one clock read, one sanitizer,
 * shared with the relisted-disclosure sentence right below the chip row.
 */
export type FactChipKind = "work_type" | "employment_type" | "experience_level" | "salary" | "posted" | "first_seen";

export interface FactChip {
    kind: FactChipKind;
    label: string;
}

export function buildFactChips(
    job: PublicJob,
    postedRelative: string | null,
    firstSeenRelative: string | null,
): FactChip[] {
    const chips: FactChip[] = [];
    const workType = prettyEnum(job.work_type);
    if (workType) chips.push({ kind: "work_type", label: workType });
    const employmentType = prettyEnum(job.employment_type);
    if (employmentType) chips.push({ kind: "employment_type", label: employmentType });
    const experienceLevel = prettyEnum(job.experience_level);
    if (experienceLevel) chips.push({ kind: "experience_level", label: experienceLevel });
    const salary = salaryText(job);
    if (salary) chips.push({ kind: "salary", label: salary });
    if (postedRelative) chips.push({ kind: "posted", label: `Posted ${postedRelative}` });
    if (firstSeenRelative) chips.push({ kind: "first_seen", label: `First seen ${firstSeenRelative}` });
    return chips;
}

/**
 * Honest "when was this posting's ghost-risk check last run" line for the
 * ghost-verdict module (2026-08-01 explained-verdict deliverable).
 *
 * This is a DIFFERENT concern from posting freshness (posted/first-seen,
 * posting-freshness.ts, which describe the LISTING's age): `ghost_checked_at`
 * is when the check itself last ran, and it is the ONLY field that may answer
 * this question. It read `updated_at` — the last scrape — until 2026-08-17,
 * which is how a modal came to show "checked 89d ago" directly above "first
 * seen by us 89d ago": the same column printed twice under two different
 * labels. When `ghost_checked_at` is missing or doesn't parse there is
 * nothing to claim — say so rather than falling back to a timestamp that
 * answers a different question, and never fabricate a checklist of what was
 * inspected beyond the badge's own `explain` copy (ghost_badge is a coarse
 * public-safe verdict; the underlying signals are not exposed to this layer
 * — see PublicJob's `ghost_badge` doc comment, types.ts).
 */
export function ghostCheckedText(
    job: GhostChecked & { first_seen_at?: string | null },
    now: number,
): string {
    const checkTs = job.last_observed_alive_at || job.ghost_checked_at;
    if (!checkTs || Number.isNaN(Date.parse(checkTs))) return "Check time unavailable";

    // Deduplicate intake check from first-seen age:
    // When a job was only checked once at intake and never re-checked since, and that intake
    // was more than 7 days ago, rendering "checked 17d ago" directly above "first seen by us 17d ago"
    // is misleading and falsely makes an active posting look abandoned. In that case, honestly state
    // "Verified on intake".
    if (job.first_seen_at) {
        const checkMs = Date.parse(checkTs);
        const firstSeenMs = Date.parse(job.first_seen_at);
        if (!Number.isNaN(firstSeenMs) && Math.abs(checkMs - firstSeenMs) < 3600_000 && now - checkMs > 7 * 86_400_000) {
            return "Verified on intake";
        }
    }

    return checkedAgeText(checkTs, now);
}

/**
 * The bare "when did a dated check last run" string, shared by the ghost
 * verdict above and the exposure badges below (`deriveExposureBadges`, whose
 * `google_indexed_at`/`linkedin_indexed_at` are the same kind of fact about a
 * different check). Split out when `ghostCheckedText` started taking the job
 * instead of a timestamp: the exposure badges were borrowing that function
 * purely for its string shape, and letting them keep passing a loose
 * timestamp into it would have re-opened the exact hole this change closes.
 */
export function checkedAgeText(checkedAt: string | null | undefined, now: number): string {
    if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) return "Check time unavailable";
    return `Checked ${formatRelativeAge(checkedAt, now)}`;
}

/**
 * What one ghost-check line actually establishes.
 *
 * Three states, not a boolean, because "we looked and it's bad" and "there
 * is nothing to look at" are different facts and were being reported as the
 * same one. `positive: boolean` used to carry both — its own doc comment
 * called `false` "a neutral '—' fact, never a fabricated negative", but the
 * only consumer that counted (`positiveSignalCount / signals.length`,
 * JobDetail) read every `false` as a failed check. Live 2026-08-16 a
 * perfectly ordinary posting rendered "1/4 favorable" whose other three
 * lines were an untracked repost history (no data source exists at all),
 * an undisclosed salary, and its age.
 *
 * `unknown` is therefore a first-class outcome: it is never counted against
 * a posting, and a signal that can never be anything else (see the reposts
 * line below) can no longer drag every job's score down by construction.
 */
export type GhostSignalStatus = "favorable" | "unfavorable" | "unknown";

export interface GhostSignal {
    text: string;
    /** favorable = ✓ (a fact in the posting's favor); unfavorable = a fact
     *  against it; unknown = nothing was observed either way — an absence of
     *  data, never scored as a negative. */
    status: GhostSignalStatus;
    /** Which fact family this line belongs to — drives the mono `key` label
     *  in the ghost-check ledger (JobDetail.tsx); one signal, one kind, set
     *  right where each line is pushed below so the two can never drift. */
    kind: "freshness" | "reposts" | "description" | "pay";
}

/** The signals that actually carry a verdict — the honest denominator for
 *  "N of M favorable". Excludes `unknown` by construction, so no caller can
 *  reintroduce the "absence counted as failure" bug by dividing by
 *  `signals.length` again. */
export function assessedGhostSignals(signals: readonly GhostSignal[]): GhostSignal[] {
    return signals.filter((s) => s.status !== "unknown");
}

/** Below this length a description doesn't back an honest "has real
 *  substance" claim, even though it produced at least one DescBlock. */
const SUBSTANTIAL_DESCRIPTION_MIN_CHARS = 200;

/**
 * The EXPANDED ghost module's signal list (docs-mockup.html Comp B2) — every
 * line is a fact this app can already point at, never an inferred or
 * fabricated one (standing rule: surface facts, not inference). Each signal
 * reuses an EXISTING single source rather than re-deriving its own date math
 * or salary parsing:
 *   - freshness reads `classifyPostingFreshness` (posting-freshness.ts) —
 *     the same classifier JobDetail's relisted disclosure sentence already
 *     reads, so the two can't disagree.
 *   - substance reads the caller's own `formatDescription` block count
 *     (JobDetail already computes this — no second parse here) plus the raw
 *     description length.
 *   - salary reads `salaryText` (presentation.ts) — the same formatter the
 *     facts row's salary chip uses.
 * A signal is OMITTED (not rendered false/negative) when the underlying
 * field is simply absent — e.g. no `first_seen_at` at all means freshness
 * has nothing to report, not a false "no signal".
 * Salary is the one signal that's always renderable: its absence IS the
 * fact ("not disclosed"), matching the mock's own "— salary not disclosed"
 * line.
 *
 * ITEM T correction (Vivek, 2026-08-15): a RELIST (posted date refreshed on
 * the same listing) is NOT a REPOST (role closed and reopened as a new
 * listing — close/reopen history). They were conflated here: the reposts
 * line used to read `freshness.kind`, so every relisted job silently
 * reported "no repost history" (true only by accident — the field it was
 * borrowing measures date-refresh, not close/reopen). The relist signal now
 * lives ONLY on the freshness line (its own fact family); the reposts line
 * is decoupled entirely. There is no close/reopen data source in the corpus
 * (grepped `PublicJob` — no `repost_count`/`relist_count` field exists), so
 * the reposts line always reads a neutral absence, never a green ✓ — a
 * "no repost history" claim would overclaim evidence this app doesn't have.
 * Flip it to real ✓/— once that data exists.
 */
export function deriveGhostSignals(
    job: PublicJob,
    freshness: PostingFreshness,
    descBlockCount: number,
    nowMs: number,
): GhostSignal[] {
    const signals: GhostSignal[] = [];

    if (freshness.firstSeenMs != null) {
        const firstSeenRelative = formatRelativeAge(new Date(freshness.firstSeenMs).toISOString(), nowMs);
        signals.push(
            freshness.kind === "relisted"
                ? { text: `first seen by us ${firstSeenRelative} · posted date refreshed since`, status: "unfavorable", kind: "freshness" }
                : freshness.kind === "fresh"
                  ? { text: "posted within the last 7 days", status: "favorable", kind: "freshness" }
                  : { text: `first seen by us ${firstSeenRelative}`, status: "unfavorable", kind: "freshness" },
        );
        // `unknown`, not `unfavorable`: there is no close/reopen data source
        // in the corpus at all (see this function's doc comment), so this
        // line can NEVER come back favorable. Scoring it as a negative made
        // every job with a first-seen date permanently lose a point for a
        // check that was never run — `shouldShowAgeBalanceNote` had already
        // hand-excluded it for exactly that reason; the status now says it
        // once, where the signal is created, instead of at each reader.
        signals.push({ text: "repost (close/reopen) history not tracked yet", status: "unknown", kind: "reposts" });
    }

    const descLength = job.description?.trim().length ?? 0;
    if (descLength > 0) {
        signals.push(
            descBlockCount > 0 && descLength >= SUBSTANTIAL_DESCRIPTION_MIN_CHARS
                ? { text: "description has real substance", status: "favorable", kind: "description" }
                : { text: "description is thin", status: "unfavorable", kind: "description" },
        );
    }

    const salary = salaryText(job);
    // An undisclosed salary is a gap in what the EMPLOYER published, not
    // evidence about whether the role is real — and the line's own copy has
    // always conceded that ("common for some regions"). It reports as an
    // absence; a posting is not marked down for it.
    signals.push(
        salary
            ? { text: `salary disclosed — ${salary}`, status: "favorable", kind: "pay" }
            : { text: "salary not disclosed (common for some regions)", status: "unknown", kind: "pay" },
    );

    return signals;
}

/**
 * A representative sample of `deriveGhostSignals`' output — one line per
 * fact family (freshness/reposts/description/pay), using the EXACT strings
 * that function produces for a typical fresh, substantive, undisclosed-salary
 * posting. Used by the /jobs front door's at-rest detail pane (no job is
 * selected there, so there is no real `PublicJob` to derive signals FROM) to
 * preview what the "posting check" looks like without inventing new copy —
 * a test asserts these four strings are a literal subset of what
 * `deriveGhostSignals` actually emits, so this can't drift into a fabricated
 * claim about what the check does.
 */
export const REPRESENTATIVE_GHOST_SIGNALS: GhostSignal[] = [
    { text: "posted within the last 7 days", status: "favorable", kind: "freshness" },
    { text: "repost (close/reopen) history not tracked yet", status: "unknown", kind: "reposts" },
    { text: "description has real substance", status: "favorable", kind: "description" },
    { text: "salary not disclosed (common for some regions)", status: "unknown", kind: "pay" },
];

/** Ghost-check ledger tagline — single source of truth for JobDetail.tsx's
 *  posting-check footer and any other surface (the front door's at-rest
 *  pitch pane) that previews the same feature. */
export const GHOST_CHECK_TAGLINE = "every signal automated · nothing inferred";

export interface ExposureBadge {
    label: string;
    /** When THIS specific check last ran — reuses `ghostCheckedText`'s
     *  formatting/fallback so the whole trust cluster speaks in one voice. */
    checkedText: string;
}

/**
 * S4 — exposure trust badges (dark launch, ships with no visible change
 * until Subspace's upstream backfill lands): "Seen on Google" / "On
 * LinkedIn" render ONLY when the job doc carries the boolean flag as exactly
 * `true` AND its paired timestamp — never on absence, never on `false`
 * (standing rule: positive-only, no fabricated/negative state — same
 * principle `deriveGhostSignals` above follows). `is_indexed_google` /
 * `is_indexed_linkedin` + their `*_indexed_at` pairs (PublicJob, types.ts)
 * are being added upstream and are absent on every doc today, so this
 * returns `[]` for the whole corpus until that backfill ships — that IS the
 * dark launch, no separate feature flag needed.
 */
export function deriveExposureBadges(job: PublicJob, nowMs: number): ExposureBadge[] {
    const badges: ExposureBadge[] = [];
    if (job.is_indexed_google === true && job.google_indexed_at) {
        badges.push({ label: "Seen on Google", checkedText: checkedAgeText(job.google_indexed_at, nowMs) });
    }
    if (job.is_indexed_linkedin === true && job.linkedin_indexed_at) {
        badges.push({ label: "On LinkedIn", checkedText: checkedAgeText(job.linkedin_indexed_at, nowMs) });
    }
    return badges;
}

export interface KpiStatChip {
    value: string;
    label: string;
}

/**
 * A single job document's own opened/closed-90d pair, or `null` when either
 * half is missing — the SAME both-or-neither gate `resolveTrackRecord`
 * (`lib/companies/aggregates.ts`) applies across a company's hit list,
 * applied here to the one job doc a detail view already has in hand. Used to
 * live inline (and duplicated) at both call sites of `pairedKpiChips` below;
 * pulled out so "half a history is not a track record" is enforced in one
 * place, not re-typed at each render site.
 */
export function jobTrackRecord(job: PublicJob): TrackRecord | null {
    return typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number"
        ? { opened90d: job.company_opened_90d, closed90d: job.company_closed_90d }
        : null;
}

/**
 * The employer rail's "opened / closed, 90d" KPI, reshaped into two
 * independent labeled chips instead of one slash-joined string. Joined as
 * "6/5" it reads as a fraction or a rating on every job detail view (launch-
 * consistency sweep, 2026-09) — the fix is the render SHAPE, not that
 * instance's numbers, so it uses the exact same value+label chip shape every
 * other KPI in this rail already renders (see "Live roles" in
 * JobDetail.tsx/JobDetailDocument.tsx): two chips side by side can never read
 * as a fraction again, regardless of what either number is.
 *
 * Pure reshape only — takes an already-resolved `TrackRecord` (see
 * `jobTrackRecord` above), so a missing half can never reach it.
 */
export function pairedKpiChips(record: TrackRecord): KpiStatChip[] {
    return [
        { value: formatCount(record.opened90d), label: "Opened, 90d" },
        { value: formatCount(record.closed90d), label: "Closures observed, 90d" },
    ];
}

/**
 * The Apply button's copy — ONE string for every surface that renders it
 * (SERP desktop split pane, standalone `/jobs/[slug]` page, mobile sticky
 * action bar) so they cannot drift apart again (launch-consistency sweep,
 * 2026-09: the desktop split pane read a bare "Apply" while the other two
 * surfaces already said "Apply on Company Site"). The longer form is the
 * more honest one — the button always navigates to the employer's own
 * posting, never an in-app application flow, and applying stays fully
 * self-serve for guests with no sign-in gate.
 */
export const APPLY_BUTTON_LABEL = "Apply on Company Site";

/** First comma segment of a job's full location text ("Redmond, WA, US" →
 *  "Redmond") — keeps the "also in" chip compact instead of wrapping full
 *  addresses for every duplicate posting's location. */
function shortPlace(job: PublicJob): string {
    return locationText(job).split(",")[0]!.trim();
}

/** Cap on distinct places named in the "also in" chip before collapsing the
 *  remainder into a "+N more" tail (docs-mockup.html Comp B2's cluster chip). */
const ALSO_IN_MAX = 3;

/**
 * "Also in …" chip label for a job's OTHER cluster variants (same
 * normalized title + company, different location — `lib/jobs/cluster.ts`).
 * `null` when there's nothing to say — a job with no variants, or whose
 * variants all share this job's own place, renders no chip rather than an
 * empty "also in" one.
 */
export function alsoInLabel(job: PublicJob, variants: PublicJob[]): string | null {
    if (variants.length === 0) return null;
    const here = shortPlace(job);
    const places = [...new Set(variants.map(shortPlace).filter((p) => p && p !== here))];
    if (places.length === 0) return null;
    const shown = places.slice(0, ALSO_IN_MAX);
    const remainder = places.length - shown.length;
    return remainder > 0 ? `${shown.join(" · ")} +${remainder} more` : shown.join(" · ");
}
