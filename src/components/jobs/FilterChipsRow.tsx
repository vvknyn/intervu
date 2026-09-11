"use client";

import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { chipVariants } from "@/components/ui/chip";
import type { FacetDistribution, FacetKey, PostedBucket } from "@/lib/jobs/types";
import { SALARY_PRESETS, appliedPostedBucket, postedBucketLabel, type FilterState } from "@/components/jobs/FilterPanel";
import { toolbarChipClass } from "@/lib/jobs/toolbar-control-height";
import { isRemoteWorkTypeValue } from "@/lib/jobs/meilisearch";

/**
 * Mobile "Posted" chip cycle — a tighter subset of the rail's full
 * `POSTED_BUCKET_PRESETS` (FilterPanel.tsx), which also offers "Older than
 * 30 days". A single-tap chip cycling through 6 states (including a
 * rarely-used "older" bucket) is worse mobile UX than the rail's full menu,
 * so this intentionally stops at 30d (Task 10 brief). Labels still come
 * from the shared `postedBucketLabel`, so the two surfaces can never
 * disagree on what a bucket is CALLED — only on which subset a quick chip
 * cycles through.
 */
const POSTED_CHIP_CYCLE: (PostedBucket | undefined)[] = [undefined, "1d", "3d", "7d", "30d"];

/**
 * Steps from what is APPLIED, not from what sits in state. Cycling the raw
 * bucket made the first tap on a fresh visit go 30d → "Any" — a step that
 * widened nothing (30d was never sent) on a chip that already claimed to be
 * active. From the applied value the same cycle starts at the tightest real
 * window, so the first tap always changes the result set.
 */
/**
 * The quick chip's face: the applied window's label, or `null` when no date
 * filter is on — the chip then reads "Posted" and draws inactive. Pure and
 * exported because the chip's own claim about what is filtering is the thing
 * that was wrong; a JSX expression can't be asserted, this can.
 */
export function postedChipLabel(
    state: Pick<FilterState, "postedBucket" | "postedExplicit">,
): string | null {
    const applied = appliedPostedBucket(state);
    return applied ? postedBucketLabel(applied) : null;
}

export function nextPostedBucket(
    state: Pick<FilterState, "postedBucket" | "postedExplicit">,
): PostedBucket | undefined {
    const idx = POSTED_CHIP_CYCLE.indexOf(appliedPostedBucket(state));
    return POSTED_CHIP_CYCLE[(idx + 1) % POSTED_CHIP_CYCLE.length];
}

/**
 * Steps to the next preset ABOVE `current`, wrapping to "Any" past the top —
 * generic over any starting value, not just the five exact preset amounts.
 * Review fix (2026-07-19): the prior `findIndex`-based cycle returned -1 for
 * an off-ladder `salaryMin` (e.g. `?salaryMin=75000` from a hand-edited or
 * legacy URL), and `(-1 + 1) % length === 0` landed on "Any" — the first tap
 * CLEARED the filter instead of stepping up. Finding the next preset whose
 * value exceeds `current` handles every off-ladder value the same way,
 * without special-casing any one of them.
 */
export function nextSalaryPreset(current: number): number {
    const next = SALARY_PRESETS.find((s) => s.value > current);
    return next ? next.value : SALARY_PRESETS[0].value;
}

/**
 * Derives the `work_type` facet VALUE that means "remote" for whatever this
 * corpus happens to call it — never a hardcoded `"remote"` string, since the
 * upstream feed's casing/spelling isn't a contract ("Remote", "remote_us",
 * etc. must all match). Picks the highest-count match so a corpus exposing
 * more than one remote-ish key still lands on the one most jobs actually
 * use. Returns `undefined` when no `work_type` value looks like "remote" —
 * including while the facet distribution hasn't loaded yet — callers must
 * treat the chip as inert in that case, not fall back to a guessed string.
 */
export function pickRemoteFacetValue(distribution: FacetDistribution | undefined): string | undefined {
    const workTypes = distribution?.work_type;
    if (!workTypes) return undefined;
    const matches = Object.keys(workTypes).filter(isRemoteWorkTypeValue);
    if (matches.length === 0) return undefined;
    return matches.reduce((best, k) => (workTypes[k] > workTypes[best] ? k : best), matches[0]);
}

function Chip({
    active,
    disabled,
    onClick,
    children,
    className,
}: {
    active: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                chipVariants({ active }),
                toolbarChipClass,
                "shrink-0 self-stretch leading-none gap-1 border-y-0 border-r-0",
                !active && "border-l-0",
                className,
            )}
        >
            {children}
        </button>
    );
}

/**
 * Mobile quick-filter row (Task 10) — `lg:hidden`, horizontally scrollable.
 * Renders the SAME `FilterState` model FilterPanel does, with the same
 * callback signatures (FilterPanel.tsx:84-101) — every tap here routes
 * through page.tsx's existing mutators (`onToggleFacet`/`onSalaryMin`/
 * `onPostedBucket`), the single place that turns an interaction into URL
 * state. This component only decides which values a compact chip cycles
 * through and how to label them; it holds no parallel filter logic.
 *
 * Quick filters ONLY. This row deliberately holds no way into the full filter
 * panel: the toolbar's `filters-toggle` owns that door at every breakpoint,
 * and when this row carried one too, a phone rendered two identically labelled
 * "Filters" buttons about 60px apart (2026-08-24). The prop that fed it is
 * gone rather than the button alone, so a second door can't be reopened here
 * without changing the component's shape — which is the part a reviewer sees.
 */
export function FilterChipsRow({
    state,
    distribution,
    onPostedBucket,
    onToggleFacet,
    onSalaryMin,
    postedDateSupported,
}: {
    state: FilterState;
    distribution: FacetDistribution | undefined;
    onPostedBucket: (v: PostedBucket | undefined) => void;
    onToggleFacet: (key: FacetKey, value: string) => void;
    onSalaryMin: (v: number) => void;
    /** False when the corpus carries no `posted_ts` — the chip is hidden rather than offered dead. */
    postedDateSupported: boolean;
}) {
    const remoteValue = pickRemoteFacetValue(distribution);
    const remoteActive = remoteValue != null && (state.facets.work_type ?? []).includes(remoteValue);
    const salaryActive = state.salaryMin > 0;
    // Review fix: an off-ladder `salaryMin` has no exact SALARY_PRESETS match
    // — falling all the way back to the inert "Salary" label left the chip
    // rendering ACTIVE (highlighted) while reading as if nothing were
    // selected. Falls back to a derived "$Nk+" (matching the presets' own
    // label style) instead, generic over any value, not just a known one.
    const postedLabel = postedChipLabel(state);
    const salaryLabel = salaryActive
        ? (SALARY_PRESETS.find((s) => s.value === state.salaryMin)?.label ?? `$${Math.round(state.salaryMin / 1000)}k+`)
        : undefined;

    return (
        <div
            role="group"
            aria-label="Quick filters"
            className="flex shrink-0 items-stretch divide-x divide-border border border-border bg-background lg:hidden"
        >
            {/* Same rule as the rail's "Date posted" section: no control when the
                corpus can't answer it. Both surfaces read one flag so they can't
                disagree about what's offerable. */}
            {postedDateSupported && (
                <Chip
                    active={!!postedLabel}
                    onClick={() => onPostedBucket(nextPostedBucket(state))}
                >
                    {postedLabel ?? "Posted"}
                    <CaretDown size={16} weight="bold" />
                </Chip>
            )}
            <Chip
                active={remoteActive}
                disabled={remoteValue == null}
                onClick={() => {
                    if (remoteValue) onToggleFacet("work_type", remoteValue);
                }}
            >
                Remote
            </Chip>
            <Chip
                active={salaryActive}
                onClick={() => onSalaryMin(nextSalaryPreset(state.salaryMin))}
            >
                {salaryLabel ?? "Salary"}
                <CaretDown size={16} weight="bold" />
            </Chip>
        </div>
    );
}
