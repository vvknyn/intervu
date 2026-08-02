import { formatRelativeAge } from "@/lib/jobs/freshness";
import { locationText, prettyEnum, salaryText } from "@/lib/jobs/presentation";
import type { PostingFreshness } from "@/lib/jobs/posting-freshness";
import type { PublicJob } from "@/lib/jobs/types";

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
 * posting-freshness.ts, which describe the LISTING's age): `updated_at` is
 * the only field carrying when the check itself last ran (the same field
 * `checkFreshness`/badges.ts's "clear" branch already keys the stale-verdict
 * swap off). When it's missing or doesn't parse there is nothing to claim —
 * say so rather than inventing a time, and never fabricate a checklist of
 * what was inspected beyond the badge's own `explain` copy (ghost_badge is
 * a coarse public-safe verdict; the underlying signals are not exposed to
 * this layer — see PublicJob's `ghost_badge` doc comment, types.ts).
 */
export function ghostCheckedText(updatedAt: string | null, now: number): string {
    if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) return "Check time unavailable";
    return `Checked ${formatRelativeAge(updatedAt, now)}`;
}

export interface GhostSignal {
    text: string;
    /** true = ✓ (a fact in the posting's favor); false = a neutral "—" fact,
     *  never a fabricated negative — see the doc comment below. */
    positive: boolean;
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
 *   - freshness + repost history both read `classifyPostingFreshness`
 *     (posting-freshness.ts) — the same classifier JobDetail's relisted
 *     disclosure sentence already reads, so the two can't disagree.
 *   - substance reads the caller's own `formatDescription` block count
 *     (JobDetail already computes this — no second parse here) plus the raw
 *     description length.
 *   - salary reads `salaryText` (presentation.ts) — the same formatter the
 *     facts row's salary chip uses.
 * A signal is OMITTED (not rendered false/negative) when the underlying
 * field is simply absent — e.g. no `first_seen_at` at all means freshness
 * and repost-history have nothing to report, not a false "no signal".
 * Salary is the one signal that's always renderable: its absence IS the
 * fact ("not disclosed"), matching the mock's own "— salary not disclosed"
 * line.
 */
export function deriveGhostSignals(
    job: PublicJob,
    freshness: PostingFreshness,
    descBlockCount: number,
    nowMs: number,
): GhostSignal[] {
    const signals: GhostSignal[] = [];

    if (freshness.firstSeenMs != null) {
        signals.push(
            freshness.kind === "fresh"
                ? { text: "freshness — posted within the last 7 days", positive: true }
                : {
                      text: `first seen by us ${formatRelativeAge(new Date(freshness.firstSeenMs).toISOString(), nowMs)}`,
                      positive: false,
                  },
        );
        signals.push(
            freshness.kind === "relisted"
                ? { text: "relisted from an earlier posting", positive: false }
                : { text: "no repost history on this role", positive: true },
        );
    }

    const descLength = job.description?.trim().length ?? 0;
    if (descLength > 0) {
        signals.push(
            descBlockCount > 0 && descLength >= SUBSTANTIAL_DESCRIPTION_MIN_CHARS
                ? { text: "description has real substance", positive: true }
                : { text: "description is thin", positive: false },
        );
    }

    const salary = salaryText(job);
    signals.push(
        salary
            ? { text: `salary disclosed — ${salary}`, positive: true }
            : { text: "salary not disclosed (common for some regions)", positive: false },
    );

    return signals;
}

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
