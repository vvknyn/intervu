import { formatRelativeAge } from "@/lib/jobs/freshness";
import { prettyEnum, salaryText } from "@/lib/jobs/presentation";
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
