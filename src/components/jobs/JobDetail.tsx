"use client";

import { useState, useMemo, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ContextHelp } from "@/components/ui/context-help";
import { ShareAction } from "@/components/ui/share-action";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { MatchChip } from "@/components/jobs/MatchChip";
import type { MatchScore } from "@/lib/match/score";
import { ReportJobButton } from "@/components/jobs/ReportJobButton";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { assessedGhostSignals, buildFactChips, deriveExposureBadges, deriveGhostSignals, ghostCheckedText, alsoInLabel } from "@/components/jobs/job-detail-facts";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { jobCompanyHref } from "@/lib/companies/paths";
import { extractCompanyAboutLine } from "@/lib/companies/about-line";
import { cn } from "@/lib/utils";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { checkFreshness } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { ghostMetaFor, decodeText, displayCompany, displayCompanyBrand, locationText, placeWithWorkMode, clampLocationSegments, shortDate, salaryText, postedAgeShort } from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { presentJob } from "@/lib/presentation";
import { STATUS_PILL, LISTING_STATE_TEXT } from "@/lib/ui/status-tokens";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { jobShareUrl } from "@/lib/jobs/share-url";
import { withShareRef } from "@/lib/share/share-decision";
import { captureEvent, type EventSource } from "@/lib/analytics/events";
import { recordGuestJobView } from "@/lib/auth/guest-engage-nudge";
import { SHARE_JOB_TEXT } from "@/lib/seo/constants";
import { POSTING_AGE_CONTEXT_COPY, isAgeSignal, shouldShowAgeBalanceNote } from "@/lib/jobs/ghost-context-copy";
import { getRelatedJobsAction, getCompanyOpenCountAction } from "@/actions/jobs";
import { shouldSuppressOpenCount, type OpenCount } from "@/lib/companies/open-count";
import { openCountText, buildCompanyJobsUrl } from "@/lib/companies/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { Pursuit } from "@/lib/pursuits/types";
import { resolveDescriptionSectionState, DESCRIPTION_SLOW_HINT_MS } from "@/lib/jobs/description-section-state";
import { LocalCustomizePanel } from "@/components/jobs/LocalCustomizePanel";
import type { ResumeData } from "@/types/resume";

/**
 * The job detail panel — everything we know about one posting.
 *
 * Lifted out of app/page.tsx, which was its only caller while `/` was the only
 * surface that could open a posting. A pursuit (/yours/[id]) now opens the same
 * panel, and a second copy of this would be a second place for the verdict
 * banner, the freshness disclosure and the CTA rules to drift. Presentation
 * helpers it shares with the ledger row live in lib/jobs/presentation.
 *
 * `now` is threaded in by the caller rather than sampled here: this renders
 * from a render body, where a clock read is the impure-render class that
 * react-hooks/purity flags.
 */

/** Render structured description blocks (heading / para / list). Descriptions
 *  arrive flattened from the Subspace feed; `formatDescription` reconstructs
 *  the structure. See lib/jobs/format-description.ts.
 *
 *  `headingLevel` is the caller's own "About this role" section-heading
 *  level + 1 — these headings ("Key Responsibilities" etc.) sit one level
 *  under it in the outline, so each mount passes what keeps that true: the
 *  inline pane/sheet (JobDetail.tsx, "About this role" = h3) passes 4, the
 *  standalone document (JobDetailDocument.tsx, "About this role" = h2)
 *  passes 3. No default — a heading level is never a safe guess. */
export function JobDescription({ blocks, headingLevel }: { blocks: DescBlock[]; headingLevel: 3 | 4 }) {
    const HeadingTag = `h${headingLevel}` as const;
    return (
        <div className="text-base leading-normal text-foreground">
            {blocks.map((b, i) => {
                if (b.type === "heading") {
                    return (
                        <HeadingTag
                            key={i}
                            className="mb-2 mt-4 text-xs font-semibold text-foreground first:mt-0"
                        >
                            {b.text}
                        </HeadingTag>
                    );
                }
                if (b.type === "list") {
                    return (
                        <ul key={i} className="mb-3 list-disc space-y-1 pl-5 last:mb-0">
                            {(b.items ?? []).map((it, j) => (
                                <li key={j}>{it}</li>
                            ))}
                        </ul>
                    );
                }
                return (
                    <p key={i} className="mb-3 whitespace-pre-line last:mb-0">
                        {b.lead && <strong className="text-foreground">{b.lead} </strong>}
                        {b.text}
                    </p>
                );
            })}
        </div>
    );
}

/**
 * The single "· "-joining seam for every flowing facts/meta line in the jobs
 * surfaces (SERP row, SERP detail panel, /jobs/[slug] hero) — rulebook item a.
 * Each caller supplies its own ordered, already-filtered list of nodes (or
 * `false`/`null` for an absent fact); this component drops the absent ones
 * and attaches the "·" to the END of the item that precedes it, inside that
 * item's own inline-flex span, so a wrapped line always starts with real
 * content — never an orphaned leading "·" (the bug this replaces: three
 * separate hand-written joins, one of which didn't separate at all, another
 * of which put the dot at the START of each item and let it wrap alone). */
export function MetaLine({ items }: { items: Array<ReactNode | null | false | undefined> }) {
    const visible = items.filter((n): n is ReactNode => n != null && n !== false);
    return (
        <>
            {visible.map((node, i) => (
                <span key={i} className="inline-flex items-baseline">
                    {node}
                    {i < visible.length - 1 && (
                        // `mx-1`, not `ml-1`: the dot's own spacing must be
                        // symmetric and self-contained, not depend on the
                        // caller's flex container also carrying `gap-x-*`
                        // (the SERP row's container didn't, so with a
                        // one-sided `ml-1` its line rendered "Onsite
                        // ·Actively posted" — no space after the dot).
                        <span className="mx-1" aria-hidden>
                            ·
                        </span>
                    )}
                </span>
            ))}
        </>
    );
}

/**
 * The "posting check" signals grid — the one seam shared by JobDetail.tsx's
 * SERP panel and JobDetailDocument.tsx's Receipt (both previously hand-wrote
 * an identical `grid-cols-1 ... sm:grid-cols-2` wrapper around their own
 * `signals.map(...)`, only the per-cell content differs between the two).
 * `sm:` is a VIEWPORT breakpoint, so on a desktop viewport it went 2-column
 * even when the caller's own rendered width was the narrow ~320px
 * `/jobs/[slug]` right rail — wrapping "Reposts ..." over four lines. A
 * `@container` query measures this wrapper's OWN width instead: the SERP
 * detail column (~800px) still gets 2 columns, the narrow rail collapses to
 * 1. (Container queries can't target the container element's own box, so
 * the containment and the queried grid have to be two nested elements.) */
export function PostingCheckSignalsGrid({ children }: { children: ReactNode }) {
    return (
        <div className="@container">
            <div className="mono-data grid grid-cols-1 gap-x-4 gap-y-2 pt-3 text-sm @min-[480px]:grid-cols-2">{children}</div>
        </div>
    );
}

/**
 * The "posting check" header row — title + ratio on one side, verdict word +
 * checked-time on the other — another seam shared by JobDetail.tsx's SERP
 * panel and JobDetailDocument.tsx's Receipt (both previously hand-wrote an
 * identical `sm:flex-row sm:items-center sm:justify-between` wrapper here
 * too). Same `sm:` VIEWPORT-breakpoint bug as the signals grid above: the
 * narrow ~320px `/jobs/[slug]` rail sits at a desktop viewport width, so
 * `sm:` (640px) fired and forced the row horizontal into 320px, wrapping
 * "Actively posted" onto its own line. Reuses the grid's own `@min-[480px]`
 * container threshold — the same narrow-container condition, not a second
 * invented breakpoint — so the rail stacks (as mobile already did) while the
 * ~800px SERP column still goes horizontal. */
export function PostingCheckHeader({
    favorableCount,
    assessedCount,
    unknownCount,
    verdictLabel,
    verdictClassName,
    checkedText,
    headingLevel,
}: {
    favorableCount: number;
    assessedCount: number;
    unknownCount: number;
    verdictLabel: string;
    verdictClassName: string;
    checkedText: string;
    /** This section's own outline level — h3 under the pane/sheet's h2 title
     *  (JobDetail.tsx), h2 under the standalone document's h1 (JobDetailDocument.tsx). */
    headingLevel: 2 | 3;
}) {
    const HeadingTag = `h${headingLevel}` as const;
    return (
        <div className="@container">
            <div className="flex flex-col gap-2 @min-[480px]:flex-row @min-[480px]:items-center @min-[480px]:justify-between @min-[480px]:gap-3">
                <div className="flex flex-wrap items-baseline gap-1 text-sm">
                    <HeadingTag className="font-semibold text-foreground">Posting check</HeadingTag>
                    {assessedCount > 0 && (
                        <span className="text-muted-foreground">
                            · {favorableCount}/{assessedCount} favorable
                            {unknownCount > 0 && ` · ${unknownCount} not tracked`}
                        </span>
                    )}
                </div>
                <div className="flex items-center justify-between gap-2 @min-[480px]:justify-end">
                    {/* Verdict as a plain colored WORD, not a bordered/bg pill
                        (rulebook: one attention-grabbing filled/bordered treatment
                        per view, already spent on Apply) — the color still comes
                        from the caller's own `ghost.cls`, the single tone source
                        every other verdict surface reads, so this can never
                        disagree with the row badge on what color a tone is. */}
                    <span className={cn("text-sm font-semibold", verdictClassName)}>{verdictLabel}</span>
                    <span className="text-xs text-muted-foreground">
                        {checkedText.charAt(0).toLowerCase()}{checkedText.slice(1)}
                    </span>
                </div>
            </div>
        </div>
    );
}

/**
 * Detail-panel loading placeholder (Job 1b, 2026-08-01) — shown by app/page.tsx
 * in place of `<JobDetail>` for the one real gap in the desktop aside / mobile
 * sheet's job-resolution chain: a deep-linked `?job=` id whose first search
 * page hasn't resolved yet, so neither `selected` nor the dead-link existence
 * check has an answer (that check's own in-flight state already renders its
 * own spinner via `DeadJobUnresolved`, a distinct, later state). Exported
 * from here rather than duplicated in page.tsx so the skeleton's shape (title
 * bar, chips row, action row, paragraph bars) stays next to the real layout
 * it mirrors — one place to keep both in sync. `.skeleton-bar` (globals.css)
 * carries the shimmer sweep and is disabled under `prefers-reduced-motion` by
 * the existing site-wide animation-neutralizing rule there.
 */
export function JobDetailSkeleton() {
    return (
        <div className="overflow-hidden border border-border bg-card" aria-hidden="true">
            <div className="border-b border-border p-6">
                <div className="flex items-start gap-4">
                    <div className="skeleton-bar h-12 w-12 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="skeleton-bar h-5 w-2/3" />
                        <div className="skeleton-bar h-3.5 w-1/3" />
                        <div className="flex flex-wrap gap-2 pt-1">
                            <div className="skeleton-bar h-5 w-20" />
                            <div className="skeleton-bar h-5 w-24" />
                            <div className="skeleton-bar h-5 w-16" />
                        </div>
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                    <div className="skeleton-bar h-9 w-40" />
                    <div className="skeleton-bar h-9 w-48" />
                    <div className="skeleton-bar h-9 w-32" />
                </div>
            </div>
            <div className="space-y-2 p-6">
                <div className="skeleton-bar h-3.5 w-full" />
                <div className="skeleton-bar h-3.5 w-full" />
                <div className="skeleton-bar h-3.5 w-5/6" />
                <div className="skeleton-bar h-3.5 w-2/3" />
            </div>
        </div>
    );
}

/**
 * Bottom CTA row for an open job detail — the ONE place this renders (P27
 * mobile pass, Task "sticky mobile action bar"). Previously two near-identical
 * hand-copies lived in app/page.tsx (the desktop aside and the mobile sheet),
 * which is how a duplicate like this drifts; both callers now render this
 * instead, and `/yours/[id]`'s sheet — which had no action bar at all — picks
 * one up for free by rendering it too.
 *
 * `sticky bottom-0` at every breakpoint — the bar is always rendered as the
 * LAST in-flow child of its caller's own scroll container (the job-detail
 * Sheet's `overflow-y-auto`, app/jobs/page.tsx), so it pins to that
 * container's bottom edge without needing to escape into `fixed` viewport
 * coordinates. `fixed` was tried first (2026-08 P27 pass) so the bar could
 * stack above `MobileTabBar`'s own `fixed bottom-0` nav — but the Sheet
 * paints OVER the tab bar (both are `z-50`), so on mobile a `fixed`,
 * viewport-anchored bar floated ~90px above the true visible bottom with
 * description text showing beneath it (user-reported). `sticky` fixes this
 * by construction: it can never draw outside its own scroll container, so
 * there is no separate "how far above the tab bar" offset to compute, no
 * height to measure, and no invisible flow-spacer needed to reserve its
 * space — being an ordinary in-flow box already does that.
 */
export function JobDetailActionBar({
    job,
    onOpenPosting,
    onGoAfter,
    pursuit,
    goingAfter,
    signedIn = true,
    className,
    resume,
    onAcceptLocalTailor,
}: {
    job: PublicJob;
    onOpenPosting: () => void;
    onGoAfter: () => void;
    /** The existing pursuit for this job, if the user already went after it —
     *  same contract as `JobDetail`'s own prop (see there); drives the same
     *  bookmark control rendered inline above. */
    pursuit: Pursuit | undefined;
    goingAfter: boolean;
    /** When false, guest chrome still shows "Apply" (auth is a separate step). */
    signedIn?: boolean;
    /** Accepted-but-unused (prep surface removed 2026-08-02): kept optional
     *  so callers built before the removal — e.g. app/page.tsx, out of this
     *  change's scope — still typecheck without editing their call sites. */
    onPrep?: () => void;
    /** Merged over the base classes (rulebook item a's `cn()` override
     *  pattern) — the only caller that needs this today is the standalone
     *  `/jobs/[slug]` document, which stacks this bar above the sitewide
     *  `MobileTabBar` (`bottom-12` instead of the Sheet caller's `bottom-0`,
     *  since that Sheet paints over the tab bar and this document doesn't). */
    className?: string;
    /** Local-AI résumé for on-device tailor — only passed by JobDetailDocument. */
    resume?: ResumeData | null;
    onAcceptLocalTailor?: (data: ResumeData) => void;
}) {
    return (
        <div
            data-testid="job-detail-action-bar"
            className={cn("sticky bottom-0 z-20 flex h-12 items-center gap-2 border-t border-border bg-card px-4", className)}
        >
            {job.apply_url && (
                <Button className="h-10 flex-1 gap-2 rounded-none bg-brand text-brand-foreground text-xs font-semibold hover:bg-brand transition-colors" onClick={onOpenPosting}>
                    <ArrowSquareOut weight="bold" />
                    Apply on Company Site
                </Button>
            )}
            {resume != null && (
                <LocalCustomizePanel
                    job={job}
                    resume={resume}
                    onAccept={onAcceptLocalTailor}
                    compactTrigger
                />
            )}
            {/* Same 40px icon-only ghost bookmark as the desktop action row —
                one control, restyled once, not a second hand-copy. */}
            <RowBookmarkButton pursuit={pursuit} onGoAfter={onGoAfter} goingAfter={goingAfter} />
        </div>
    );
}

/**
 * A2 — "More like this" row (Curiosity / Serial Positioning Effect). Not a
 * reuse of the SERP's `JobCard` (jobs/page.tsx): that component is
 * page-local (never exported), tightly coupled to page.tsx-only state
 * (cluster-variant expand/collapse, the verdict badge, the company-nav
 * handler) that a 5-row "more like this" list doesn't need, and importing it
 * here would be a circular import (page.tsx is JobDetail's own caller). What
 * IS reused is the single source of truth for each fact's presentation —
 * `displayCompanyBrand`/`locationText`/`salaryText`/`postedAgeShort`
 * (lib/jobs/presentation.ts) — the exact same helpers `JobCard` itself
 * calls, so this row can never format a company name, salary, or age
 * differently than the SERP does.
 */
export function RelatedJobRow({ job, now, onClick }: { job: PublicJob; now: number; onClick: () => void }) {
    const salary = salaryText(job);
    const age = postedAgeShort(derivePostedTs(job), now);
    // placeWithWorkMode, not locationText alone: this row has no adjacent
    // work-type chip (unlike JobCard's SERP row), so it's the only place a
    // remote/hybrid job's work mode can show up.
    const loc = placeWithWorkMode(locationText(job), job.work_type);
    return (
        <button
            type="button"
            data-testid="related-job-row"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            }}
            className="flex w-full flex-col gap-0.5 rounded-none px-0 py-3 text-left transition-colors hover:bg-muted cursor-pointer group"
        >
            <span className="truncate text-meta font-semibold text-foreground group-hover:text-brand transition-colors">{presentJob(job).title}</span>
            <span className="mono-data truncate text-xs text-muted-foreground">
                {displayCompanyBrand(job.company, job.company_domain, job.title) || "Unknown company"}
                {loc ? ` · ${loc}` : ""}
                {age ? ` · ${age}` : ""}
                {salary ? ` · from ${salary}` : ""}
            </span>
        </button>
    );
}

export function JobDetail({
    job,
    now,
    source,
    onOpenPosting,
    onGoAfter,
    pursuit,
    goingAfter,
    variants = [],
    onClose,
    className,
    signedIn = true,
    onRequestSignIn,
    onOpenRelated,
    reportJobEnabled = false,
    reportDialogOpen,
    onReportDialogOpenChange,
    collapseDescription = true,
    matchScore = null,
    matchAsOfDate = null,
    descriptionPending,
    onRetryDescription,
    resume = null,
    onAcceptLocalTailor,
}: {
    job: PublicJob;
    /** Single per-render-pass "now" from JobsContent — see the `nowMs` comment there. */
    now: number;
    /** Where this panel was opened from — fires `job_viewed` once per job.id mount. */
    source: EventSource;
    onOpenPosting: () => void;
    /** When false, Apply/Save gate at click; description body stays public. */
    signedIn?: boolean;
    /** Opens auth for gated actions (e.g. "Report listing") — AuthPopover on
     *  the board, a `/login` redirect on `/jobs/[slug]`, not a second gate. */
    onRequestSignIn?: () => void;
    /** ITEM O-FE (2026-08-15) — probed once by the caller via
     *  `reportJobEnabledAction`; the flags endpoint isn't deployed yet, so
     *  this defaults to hidden rather than showing a button that 404s. */
    reportJobEnabled?: boolean;
    /** Forwarded straight to `ReportJobButton`'s own `open`/`onOpenChange` —
     *  lets the caller reopen the report dialog after a gated report action
     *  replays post-auth. Both optional: omit to keep the button's own
     *  default (uncontrolled) state. */
    reportDialogOpen?: boolean;
    onReportDialogOpenChange?: (open: boolean) => void;
    /** Accepted-but-unused (prep surface removed 2026-08-02): kept optional
     *  so callers built before the removal — e.g. app/page.tsx, out of this
     *  change's scope — still typecheck without editing their call sites. */
    onPrep?: () => void;
    onGoAfter: () => void;
    /** The existing pursuit for this job, if the user already went after it. */
    pursuit: Pursuit | undefined;
    goingAfter: boolean;
    /** This job's OTHER cluster variants (same normalized title + company,
     *  different location — `lib/jobs/cluster.ts`) — feeds the header's
     *  "also in" chip. Empty for the ordinary non-clustered case. */
    variants?: PublicJob[];
    onClose?: () => void;
    className?: string;
    /** A2 — "More like this" row click. */
    onOpenRelated?: (jobId: string, job?: PublicJob) => void;
    /** Parent-is-the-scroller contract. When `false`, the mount site already
     *  owns `overflow-y-auto` (jobs/page.tsx mobile sheet's
     *  `mobile-detail-scroller`) — so JobDetail must not add a second scroll
     *  layer: no description clamp (see `collapsible` below) AND no pinned
     *  identity header (`sticky top-0` on title/chips/Apply/Save). When
     *  `true` (default), the xl+ pane uses a flex split — header stays
     *  outside the body scroller — instead of sticky inside one box.
     *  check — mount site is resolved by `resolveDetailMountSite` (state +
     *  breakpoint together); a `sm:`/`xl:` class here could silently disagree
     *  with it. */
    collapseDescription?: boolean;
    /** `scoreJobAgainstResume`'s output for this job, or `null` when there's
     *  no signed-in résumé or no comparable field — renders no chip, never a
     *  fabricated 0 (Rule 3, match-contract.md). Same value the SERP card and
     *  `sort=fit` read, computed once by the shared `PublicJobDetail` mount. */
    matchScore?: MatchScore | null;
    /** The résumé's stored update date, pre-formatted (`shortDate(...).toLowerCase()`) — the receipt's "against your résumé of {date}" line. */
    matchAsOfDate?: string | null;
    /** True when the stored description is a stub AND searchJobsAction's live
     *  fill hit its deadline still waiting on it — see description-section-
     *  state.ts's "pending" state. */
    descriptionPending?: boolean;
    /** Re-hydrates this job (clears the cached detail + refetches) — wired to
     *  the pending note's "try again" button. Omitted → the note renders
     *  without a button (see the markup below). */
    onRetryDescription?: () => void;
    /** Local-AI guest/signed-in résumé for on-device tailor — optional. */
    resume?: ResumeData | null;
    onAcceptLocalTailor?: (data: ResumeData) => void;
}) {
    const staleCheck = checkFreshness(job, now) === "stale";
    // Detail-module-only stand-in for `GHOST_META.unscored` (null there, so
    // list/company surfaces stay quiet on unscored rows): in THIS panel the
    // check ledger's facts are worth showing even before a scoring pass has
    // run — with a verdict pill that says exactly that, never a fabricated
    // clear (2026-08-14 investor-polish; founding rule: facts, no inference).
    const ghost = ghostMetaFor(job, now) ?? {
        label: "Not yet scored",
        cls: STATUS_PILL.saved,
        dot: "bg-st-saved",
        explain:
            "This posting hasn't been checked yet — the signals below are the facts we can already state.",
    };
    // S2 — HONESTY RULE: the row badge states a fact ("Fresh"/"Relisted");
    // this facts line is where the underlying dates it's based on live.
    const freshness = classifyPostingFreshness(job, now);
    const exceptionMark = rowExceptionMark(job, now);
    const postedRelative =
        freshness.postedMs != null ? formatRelativeAge(new Date(freshness.postedMs).toISOString(), now) : null;
    const firstSeenRelative =
        freshness.firstSeenMs != null ? formatRelativeAge(new Date(freshness.firstSeenMs).toISOString(), now) : null;
    const [descExpanded, setDescExpanded] = useState(false);
    useEffect(() => {
        setDescExpanded(false);
    }, [job.id]);
    useEffect(() => {
        captureEvent("job_viewed", { job_id: job.id, company_domain: job.company_domain, source });
        if (!signedIn) recordGuestJobView();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.id, source, signedIn]);
    // Identity-header location line — same progressive-disclosure idiom as
    // the description clamp above, for aggregator-feed `location` strings
    // that stuff many semicolon-joined locations into one field (see
    // clampLocationSegments's doc comment). Presentation-only: the
    // underlying `location` string is untouched.
    const [locationExpanded, setLocationExpanded] = useState(false);
    useEffect(() => {
        setLocationExpanded(false);
    }, [job.id]);
    const location = locationText(job);
    const locationDisclosure = useMemo(() => clampLocationSegments(location), [location]);
    const locationClamped = locationDisclosure.hidden.length > 0;
    // Presentation-module adoption (wave 3, ADOPTION.md): the single-location
    // display case below (`locationClamped` false — the common case) reads
    // through `presentJob` for postal/breadcrumb cleanup. The semicolon-split
    // clamp/disclosure above stays on the raw `location` string — it's
    // splitting DISTINCT locations an aggregator feed joined with ";",
    // orthogonal to (and upstream of) the single-location cleanup
    // `locationSummary` does, so cleaning before the split risks mangling a
    // semicolon-joined string that also happens to contain a dash.
    const presented = presentJob(job);
    const locationDisplay = presented.location;
    const jobTitle = presented.title;
    const blocks = useMemo(() => formatDescription(job.description), [job.description]);
    // `formatDescription(undefined)` and `formatDescription("")` both return
    // `[]` — collapsing "not yet hydrated" (list-scope stub, no `description`
    // key at all) into the same bucket as "hydrated, genuinely no
    // description." Only the field's presence distinguishes them.
    const hydrated = job.description !== undefined;
    const descriptionSectionState = resolveDescriptionSectionState({
        hydrated,
        hasBlocks: blocks.length > 0,
        pending: Boolean(descriptionPending),
    });
    // Delayed progress message for the "loading" state — resets whenever the
    // job or the state itself changes, so switching jobs (or a retry landing
    // on "body"/"pending") never leaves a stale hint counting down.
    const [showSlowHint, setShowSlowHint] = useState(false);
    useEffect(() => {
        setShowSlowHint(false);
        if (descriptionSectionState !== "loading") return;
        const timer = setTimeout(() => setShowSlowHint(true), DESCRIPTION_SLOW_HINT_MS);
        return () => clearTimeout(timer);
    }, [job.id, descriptionSectionState]);
    // Long descriptions are clamped behind a "Show more" toggle so the sticky
    // detail panel doesn't run thousands of pixels tall. `collapseDescription`
    // (default true) is the seam that turns this off for mount sites that
    // already provide their own scroller — see its doc comment above.
    const collapsible = collapseDescription && (job.description?.length ?? 0) > 700;
    // Structured facts row (Deliverable 1, 2026-08-01) — consolidates what
    // used to be a separate "Posted X · First seen by us Y" prose line plus
    // this chip row into ONE scannable row; see buildFactChips for the
    // per-field include/omit decision (kept pure + unit-tested there).
    const chips = buildFactChips(job, postedRelative, firstSeenRelative);
    // Pay now renders as its own header stat (Task 3, squared design-system
    // pass) rather than a chip among chips — filtered out here so it never
    // appears twice.
    const nonSalaryChips = chips.filter((c) => c.kind !== "salary");
    // Meta-line ordering (rulebook item a: "location · work mode · level ·
    // pay · posted · first seen") — split around where `salary` (rendered
    // separately, see above) sits, rather than reordering `buildFactChips`'
    // own field order.
    const preSalaryChips = nonSalaryChips.filter((c) => c.kind !== "posted" && c.kind !== "first_seen");
    const postSalaryChips = nonSalaryChips.filter((c) => c.kind === "posted" || c.kind === "first_seen");
    const salary = salaryText(job);
    // `cleanedCompany` keeps its legal suffix (e.g. "Qualys, Inc.") — it
    // feeds `jobCompanyHref` below, which uses it to build the `/companies/`
    // slug when the job has no `company_domain`, so it can't move to the
    // brand form without moving the slug too. `companyBrand` is the reader-
    // facing text (header, hiring-truth heading, MCP handoff copy) — same
    // split `displayCompanyBrand`'s own doc comment calls out.
    const cleanedCompany = displayCompany(job.company, job.company_domain);
    const companyBrand = displayCompanyBrand(job.company, job.company_domain, job.title);
    // Same helper /co's hero uses, but sourced from just this one posting —
    // the full-corpus call site (get-company.ts) has many more postings to
    // find repeated "about us" boilerplate across, so this returns null more
    // often. That's the honest outcome of a thinner corpus, not a bug.
    const aboutLine = useMemo(
        () => extractCompanyAboutLine([job], companyBrand || cleanedCompany || job.company || ""),
        [job, companyBrand, cleanedCompany],
    );
    const alsoIn = alsoInLabel(job, variants);
    // EXPANDED ghost module (docs-mockup.html Comp B2) — honest, derived
    // signal list; see deriveGhostSignals's doc comment for why each line
    // reuses an existing single source instead of new inferred logic.
    const ghostSignals = deriveGhostSignals(job, freshness, blocks.length, now);
    // Denominator is the ASSESSED signals, not every line rendered: an
    // untracked repost history and an undisclosed salary are absences of
    // data, and counting them as failed checks made ordinary postings read
    // "1/4 favorable" (live 2026-08-16). The unknowns are still shown — and
    // still counted, as unknowns — they just don't score against the job.
    const assessedSignals = assessedGhostSignals(ghostSignals);
    const favorableSignalCount = assessedSignals.filter((s) => s.status === "favorable").length;
    const unknownSignalCount = ghostSignals.length - assessedSignals.length;
    // Takes the job, not a timestamp: this line used to be handed
    // `job.updated_at` and so dated the verdict by the last SCRAPE, which is
    // what produced "checked 89d ago" over "first seen by us 89d ago".
    const checkedText = ghostCheckedText(job, now);
    // S4 — exposure trust badges (dark launch): [] for every job until
    // Subspace's upstream backfill lands (see deriveExposureBadges' doc).
    const exposureBadges = deriveExposureBadges(job, now);

    // A2 — "More like this." Self-contained: this panel is the only
    // consumer of the related list, so it fetches its own data (via the
    // server action directly, same as any other client component calling
    // a "use server" export) rather than page.tsx threading it through as
    // yet another prop on an already-3000-line file. `cancelled` guards
    // against a fast re-open (new `job.id` before the previous fetch lands)
    // painting a stale job's related list onto the new one.
    const [related, setRelated] = useState<PublicJob[]>([]);
    useEffect(() => {
        let cancelled = false;
        setRelated([]);
        // Guests see this list gated behind sign-in — fetching for them would
        // spend up to three corpus queries per detail-open on rows nobody can
        // read. The open-count figure below is fetched separately and does
        // NOT share this gate — see that effect's own comment for why.
        if (!signedIn) return;
        getRelatedJobsAction(job.id, job.company_domain, job.title)
            .then((data) => {
                if (cancelled) return;
                setRelated(data.jobs);
            })
            .catch(() => {
                // "More like this" is an accelerant, never a source of
                // user-visible error — the render guard below already
                // renders nothing for an empty list.
            });
        return () => {
            cancelled = true;
        };
    }, [job.id, job.company_domain, job.title, signedIn]);

    // ITEM N (2026-08-15), decoupled from sign-in 2026-08-20 — the
    // hiring-truth rail's "Live roles" figure used to read
    // `job.company_open_count`, a sync-time aggregate baked onto the job
    // document that structurally drifts from /co/[slug]'s own live count for
    // the same company (delta sync can't carry cross-table data). This used
    // to ride the `signedIn`-gated related-jobs fetch above, so guests —
    // almost certainly how a self-contradicting "0 live roles" card gets
    // seen — never got the live figure, only ever the stale one. `/co/[slug]`
    // already serves this same query to anonymous visitors with no gate at
    // all, and it's a single cheap query (unlike the 3-query related-jobs
    // list above), so it gets its own always-on fetch here instead. `null`
    // until this resolves or when the job has no `company_domain` — the
    // render below falls back to `job.company_open_count` in that window,
    // same as before this existed.
    const [liveOpenCount, setLiveOpenCount] = useState<OpenCount | null>(null);
    useEffect(() => {
        let cancelled = false;
        setLiveOpenCount(null);
        if (!job.company_domain) return;
        getCompanyOpenCountAction(job.company_domain)
            .then((count) => {
                if (!cancelled) setLiveOpenCount(count);
            })
            .catch(() => {
                // Presentation only — the render falls back to
                // `job.company_open_count`, same as before this existed.
            });
        return () => {
            cancelled = true;
        };
    }, [job.company_domain]);

    // Resolve to ONE open-count number the same way the render below reads
    // it (live figure first, stale field as fallback), then run it through
    // `shouldSuppressOpenCount` so a company whose live count is honestly 0
    // never renders "0 live roles" on a page that is itself one of that
    // company's live postings — see that function's doc comment for the
    // closed-job carve-out.
    const resolvedOpenCount =
        liveOpenCount != null ? liveOpenCount.value : typeof job.company_open_count === "number" ? job.company_open_count : null;
    const showOpenCount = resolvedOpenCount != null && !shouldSuppressOpenCount(resolvedOpenCount, job.vacancy_status === "closed");

    const hasCompanyIntel =
        showOpenCount ||
        (typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number");

    return (
        <div
            data-region="detail"
            className={cn(
                "relative rounded-none bg-card",
                collapseDescription && "flex min-h-0 flex-1 flex-col overflow-hidden",
                className,
            )}
        >
            {/* Identity block — pinned outside the scroll subtree when the pane
                owns scrolling (flex split); the mobile sheet keeps everything
                in one flow and passes collapseDescription={false}. Rulebook item d:
                this used to be its own bordered/filled panel; it now sits on page
                bg like every other section — the border-t below the identity
                content is the only divider it draws. */}
            <div className="shrink-0">
                {/* Identity header */}
                <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-4">
                    <div className="flex items-start gap-3">
                        {/* CompanyLogo's "lg" (56px) tile exceeds the rulebook's
                            48px card-size floor by construction (it's a fixed-size
                            avatar, not an authored panel) — exempted the same way
                            the SERP row exempts its own logo tile. */}
                        <div data-rulebook-exempt>
                            <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h2 className="text-xl sm:text-lg font-semibold leading-snug sm:leading-tight text-foreground">{jobTitle}</h2>
                            {matchScore && (
                                <div className="mt-2">
                                    <MatchChip score={matchScore} asOfDate={matchAsOfDate} jobId={job.id} />
                                </div>
                            )}
                            <div className="mt-1 text-sm text-muted-foreground">
                                {cleanedCompany ? (
                                    <Link href={jobCompanyHref(cleanedCompany, job.company_domain)} className="font-semibold text-foreground hover:underline">
                                        {companyBrand}
                                    </Link>
                                ) : (
                                    "Unknown company"
                                )}
                            </div>
                            {exceptionMark && (
                                // Rulebook: status reads as a plain colored WORD, not a
                                // bordered/bg pill — each part already carries its own
                                // tone via `part.className` (row-exception.ts), so the
                                // wrapper needs no border/background of its own.
                                <div data-tour="row-exception" data-exception={exceptionMark.kind} className="mt-2 text-xs font-semibold">
                                    <ContextHelp content={exceptionMark.explain} side="right">
                                        <span className="inline-flex flex-wrap items-center gap-x-1">
                                            {exceptionMark.parts.map((part, i) => (
                                                <span key={part.text} className="inline-flex items-center">
                                                    {i > 0 && (
                                                        <span className="mx-1 text-muted-foreground" aria-hidden>
                                                            ·
                                                        </span>
                                                    )}
                                                    <span className={part.className}>{part.text}</span>
                                                </span>
                                            ))}
                                        </span>
                                    </ContextHelp>
                                    {(exceptionMark.kind === "relisted" || exceptionMark.kind === "both") &&
                                        freshness.postedMs != null &&
                                        firstSeenRelative && (
                                            <p className="mt-1 font-normal text-muted-foreground">
                                                Listed as new on {shortDate(freshness.postedMs)}, but this role first appeared{" "}
                                                {firstSeenRelative} — often a relist.
                                            </p>
                                        )}
                                </div>
                            )}

                            {/* Meta line (rulebook item a): every fact JobCard's row
                                already renders as flowing text — location, work type,
                                employment type, level, pay, posted, first seen, plus
                                the also-in/reported notes — joined by the shared
                                `MetaLine` "· " seam (job-detail-facts.ts's sibling in
                                this file), no per-fact icon or box. The one exception
                                is the leading location pin (item b): at most one 16px
                                HIG prefix glyph, never a second icon after it.
                                `preSalaryChips`/`postSalaryChips` place `salary`
                                between level and posted per the rulebook's stated
                                order without reordering `buildFactChips`' own list. */}
                            <div className="mt-2 flex flex-wrap items-baseline text-sm text-muted-foreground">
                                <MetaLine
                                    items={[
                                        location && (
                                            <span className="inline-flex items-baseline gap-1" data-rulebook-exempt>
                                                <FACT_CHIP_ICON.location size={16} weight="bold" className="relative top-0.5 shrink-0" aria-hidden />
                                                {locationClamped ? (
                                                    <span className="inline-flex flex-col">
                                                        {(locationExpanded
                                                            ? [...locationDisclosure.visible, ...locationDisclosure.hidden]
                                                            : locationDisclosure.visible
                                                        ).map((segment, i) => (
                                                            <span key={i}>{segment}</span>
                                                        ))}
                                                        <button
                                                            type="button"
                                                            onClick={() => setLocationExpanded((v) => !v)}
                                                            className="mt-0.5 text-left text-xs text-brand hover:underline cursor-pointer"
                                                        >
                                                            {locationExpanded ? "Show less" : `+ ${locationDisclosure.hidden.length} more locations`}
                                                        </button>
                                                    </span>
                                                ) : (
                                                    <span>{locationDisplay}</span>
                                                )}
                                            </span>
                                        ),
                                        ...preSalaryChips.map((c) => <span key={c.kind}>{c.label}</span>),
                                        salary && (
                                            <span data-tour="jobs-pay" className="font-semibold text-foreground">
                                                {salary}
                                            </span>
                                        ),
                                        ...postSalaryChips.map((c) => {
                                            const caution = c.kind === "posted" && freshness.kind === "relisted";
                                            return (
                                                <span key={c.kind} className={caution ? LISTING_STATE_TEXT.relisted : undefined}>
                                                    {c.label}
                                                </span>
                                            );
                                        }),
                                        alsoIn && <span>also in {alsoIn}</span>,
                                        typeof job.report_count === "number" && job.report_count > 0 && (
                                            <span className="text-warn">
                                                reported {job.report_count} {job.report_count === 1 ? "user" : "users"}
                                            </span>
                                        ),
                                    ]}
                                />
                                {nonSalaryChips.some((c) => c.kind === "posted") && nonSalaryChips.some((c) => c.kind === "first_seen") && (
                                    <ContextHelp
                                        content="Employer posted is the date on their listing. First seen by us is when our crawler actually found it — a relist can reset the employer's date without the role being new."
                                        className="ml-1 self-center"
                                    />
                                )}
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {/* Rulebook item f: these were hairline-boxed 44px
                                squares — ghost 40px icon-only controls, no border.
                                Report is a detail-only action (GROUP-C, standard
                                one-entry-point-per-listing) — it lives in the
                                action row below (ReportJobButton), not here. */}
                            <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <ShareAction
                                            title={`${jobTitle} at ${companyBrand}`}
                                            text={SHARE_JOB_TEXT}
                                            url={withShareRef(
                                                jobShareUrl(typeof window !== "undefined" ? window.location.origin : "", job),
                                                "job",
                                            )}
                                            jobId={job.id}
                                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                        />
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs">Copy link</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {onClose && (
                                <button
                                    type="button"
                                    aria-label="Close"
                                    onClick={onClose}
                                    className="flex h-10 w-10 items-center justify-center rounded-none bg-muted text-base text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Action row */}
                <div className="border-t border-border px-4 py-3 sm:px-6 sm:py-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* House attention system (docs/design/ATTENTION.md,
                            channel 2): exactly one inverted-ink block per
                            view. Apply is the primary action this pane
                            exists for — same solid-foreground/background-text
                            treatment as the SERP's own Search button — not
                            the quietest element on the page. Save is the
                            secondary action: a plain 1px outline. */}
                        {job.apply_url && (
                            <Button onClick={onOpenPosting} className="gap-2 h-10 sm:h-9 px-4 rounded-none bg-brand text-brand-foreground hover:bg-brand text-xs font-semibold transition-colors">
                                <ArrowSquareOut size={16} />
                                Apply
                            </Button>
                        )}
                        {/* Bookmark: 40px icon-only ghost control (rulebook — icon
                            carries the state, no label chrome competing with Apply's
                            one inverted-ink block above). Klein-filled glyph + link to
                            the saved record when `pursuit` exists; muted outline glyph
                            + the existing `onGoAfter` handler otherwise. Same
                            `pursuit`/`goingAfter`/`onGoAfter` contract every caller
                            already threads for the row-level equivalent — no new
                            plumbing, only the restyle. */}
                        <RowBookmarkButton pursuit={pursuit} onGoAfter={onGoAfter} goingAfter={goingAfter} />
                        {reportJobEnabled && job.apply_url && (
                            <ReportJobButton
                                jobUrl={job.apply_url}
                                jobTitle={jobTitle}
                                onRequireAuth={() => onRequestSignIn?.()}
                                open={reportDialogOpen}
                                onOpenChange={onReportDialogOpenChange}
                                className="ml-auto"
                            />
                        )}
                        <LocalCustomizePanel
                            job={job}
                            resume={resume}
                            onAccept={onAcceptLocalTailor}
                        />
                    </div>
                </div>
            </div>

            <div
                className={cn(
                    "px-4 pb-6 pt-4",
                    collapseDescription && "min-h-0 flex-1 overflow-y-auto custom-scrollbar",
                )}
            >
                {/* Posting check (rulebook item e): plain flowing text, no
                    card/panel and no segmented progress bar — the ratio and
                    per-signal rows carry the same facts as sentence-case
                    text instead. First section in this scroll body, so it
                    draws no leading divider of its own. */}
                {ghost && (
                    <div data-tour="jobs-posting-check" className="pb-6">
                        <PostingCheckHeader
                            favorableCount={favorableSignalCount}
                            assessedCount={ghostSignals.length > 0 ? assessedSignals.length : 0}
                            unknownCount={unknownSignalCount}
                            verdictLabel={ghost.label}
                            verdictClassName={ghost.cls.split(" ").find((c) => c.startsWith("text-")) ?? ""}
                            checkedText={checkedText}
                            headingLevel={3}
                        />
                        {/* Explain copy only earns its place when the verdict isn't
                            already the unremarkable "clear and current" case — the
                            ratio + verdict above already say enough there. */}
                        {!(job.ghost_badge === "clear" && !staleCheck) && (
                            <div className="pt-2 text-sm text-muted-foreground">{ghost.explain}</div>
                        )}
                        {ghostSignals.length > 0 && (
                            <PostingCheckSignalsGrid>
                                {ghostSignals.map((s) => {
                                    const relistCaution = s.kind === "freshness" && freshness.kind === "relisted";
                                    return (
                                    <div key={s.text} className="flex items-start gap-2">
                                        {/* Three glyphs for two real states — the ratio above
                                            already excludes unknowns and states them as
                                            "N not tracked"; a "not tracked" row renders no
                                            glyph at all (rulebook item e), not the old shared
                                            "·" that read as a real (if neutral) finding. */}
                                        <span
                                            className={cn(
                                                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-sm font-semibold",
                                                relistCaution ? LISTING_STATE_TEXT.relisted : s.status === "favorable" ? "text-live" : "text-muted-foreground",
                                            )}
                                            aria-hidden={s.status !== "unknown"}
                                        >
                                            {relistCaution ? "!" : s.status === "favorable" ? "✓" : s.status === "unfavorable" ? "—" : null}
                                        </span>
                                        <div className="min-w-0 flex-1 leading-snug">
                                            {/* `s.kind` (job-detail-facts.ts) is always lowercase
                                                ("freshness"/"reposts"/"description"/"pay") — that
                                                module is a shared, out-of-fence source also read
                                                by JobDetailDocument.tsx, so sentence case is
                                                applied here at the render call site instead of
                                                changing the shared string. */}
                                            <b className="text-sm font-semibold capitalize text-foreground mr-2">{s.kind}</b>
                                            <span className={cn("text-sm", relistCaution ? LISTING_STATE_TEXT.relisted : "text-muted-foreground")}>
                                                {s.text}
                                                {!relistCaution && s.status === "unfavorable" && isAgeSignal(s) && shouldShowAgeBalanceNote(ghostSignals) && (
                                                    <ContextHelp content={POSTING_AGE_CONTEXT_COPY} className="ml-1 inline-block align-middle" />
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                    );
                                })}
                            </PostingCheckSignalsGrid>
                        )}
                        <div className="pt-3">
                            {/* WHEN this verdict was last checked — a stated fact from
                                `updated_at`, not a fabricated checklist of what was
                                inspected (see ghostCheckedText's doc comment). Plain
                                12/16 secondary caption, no underline signature
                                (rulebook item e). */}
                            <div className="text-xs text-muted-foreground">
                                every signal automated · nothing inferred
                            </div>
                            {/* S4 exposure trust badges (dark launch) — positive-only,
                                same quiet mono house style as the fact chips, same
                                ContextHelp tooltip mechanism as elsewhere in this
                                panel. Renders nothing until deriveExposureBadges has
                                something to say (see its doc comment). */}
                            {exposureBadges.length > 0 && (
                                <div className="mono-data mt-3 flex flex-wrap items-center text-xs text-muted-foreground">
                                    {exposureBadges.map((b, i) => (
                                        <span key={b.label} className="inline-flex items-center">
                                            {i > 0 && (
                                                <span className="mx-1" aria-hidden>
                                                    ·
                                                </span>
                                            )}
                                            {b.label}
                                            <ContextHelp
                                                content={`We check whether this posting appears in ${
                                                    b.label === "Seen on Google" ? "Google's job search results" : "LinkedIn's job listings"
                                                } — ${b.checkedText.charAt(0).toLowerCase()}${b.checkedText.slice(1)}.`}
                                                className="self-center"
                                            />
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* The ghost-check ledger and description body render for
                    everyone — posting text is public; Apply stays gated. */}
                {/* Rulebook item d: sections stack on page bg, separated by a
                    hairline top border + 24px vertical padding — no card/panel
                    per section. Body copy sits at a 640px reading measure. */}
                <div className="border-t border-border py-6">
                    <h3 className="mb-2 text-sm font-semibold text-foreground">About this role</h3>
                    {(() => {
                        // The employer's-site-is-slow note — shared by the "body" case
                        // (teaser stub still showing while the fill runs) and the
                        // "pending" case (nothing to show yet at all). Single element
                        // with a conditional lead sentence rather than two near-
                        // identical paragraphs.
                        const pendingNote = (previewLead: boolean) => (
                            <p className="max-w-[640px] text-base leading-normal text-foreground">
                                {previewLead && "This is only a preview. "}
                                The employer&apos;s site is taking a while to answer, so the full description isn&apos;t here yet.
                                {job.apply_url ? " Open the posting to read it there, or " : " "}
                                {onRetryDescription ? (
                                    <button
                                        type="button"
                                        onClick={onRetryDescription}
                                        className="text-brand hover:underline cursor-pointer"
                                    >
                                        try again
                                    </button>
                                ) : (
                                    "try again"
                                )}
                                {job.apply_url ? "." : " in a moment."}
                            </p>
                        );

                        switch (descriptionSectionState) {
                            case "body":
                                return (
                                    <>
                                        <div
                                            data-testid="job-detail-description"
                                            className={cn("relative max-w-[640px]", collapsible && !descExpanded && "max-h-[20rem] overflow-hidden")}
                                        >
                                            <JobDescription blocks={blocks} headingLevel={4} />
                                            {collapsible && !descExpanded && (
                                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
                                            )}
                                        </div>
                                        {collapsible && (
                                            <button
                                                type="button"
                                                onClick={() => setDescExpanded((v) => !v)}
                                                className="mt-2 text-sm text-brand hover:underline cursor-pointer"
                                            >
                                                {descExpanded ? "Show less" : "Show full description"}
                                            </button>
                                        )}
                                        {/* Teaser stub rendered above AND the live fill is
                                            still running — the body isn't final. */}
                                        {descriptionPending && pendingNote(true)}
                                    </>
                                );
                            case "loading":
                                return (
                                    // Not hydrated yet (the SERP's list-scope stub has no
                                    // `description` field, meilisearch.ts's
                                    // JOB_LIST_ATTRIBUTES_TO_RETRIEVE) — distinct from a
                                    // hydrated job that genuinely has no description
                                    // ("empty" case below). Rendering the neutral empty-
                                    // state copy here would claim "nothing was captured"
                                    // before the full doc even arrived. Same
                                    // `.skeleton-bar` idiom as JobDetailSkeleton.
                                    <>
                                        <div className="space-y-2" aria-hidden="true">
                                            <div className="skeleton-bar h-3.5 w-full" />
                                            <div className="skeleton-bar h-3.5 w-full" />
                                            <div className="skeleton-bar h-3.5 w-5/6" />
                                        </div>
                                        {showSlowHint && (
                                            <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
                                                Fetching the full description from the employer&apos;s site…
                                            </p>
                                        )}
                                    </>
                                );
                            case "pending":
                                return pendingNote(false);
                            case "empty":
                            default:
                                return (
                                    <p className="max-w-[640px] text-base leading-normal text-foreground">
                                        No description was captured for this role.{" "}
                                        {job.apply_url ? (
                                            <>
                                                Use{" "}
                                                <span className="font-semibold text-foreground">
                                                    Apply
                                                </span>{" "}
                                                to read the full details on the employer&apos;s site.
                                            </>
                                        ) : (
                                            "Try the original posting for full details."
                                        )}
                                    </p>
                                );
                        }
                    })()}
                </div>

                {job.tags && job.tags.length > 0 && (
                    <div className="border-t border-border py-6">
                        {/* Rulebook item c: no bordered tag chips — a sentence-case
                            label plus one flowing secondary line joined by " · ". */}
                        <div className="mb-1 text-sm font-semibold text-foreground">Keywords from the posting</div>
                        <div className="mono-data text-sm text-muted-foreground">
                            {job.tags.slice(0, 16).map(decodeText).join(" · ")}
                        </div>
                    </div>
                )}

                {/* Company hiring-truth mini-KPI rail (rulebook item g): keep
                    content, render on page bg with a hairline top divider
                    instead of a bordered/bg panel. */}
                {hasCompanyIntel && (
                    <div className="border-t border-border py-6">
                        <h3 className="text-base font-semibold text-foreground">
                            {companyBrand || "This company"} · hiring truth
                        </h3>
                        {/* Verbatim-or-absent (founding-wound law, about-line.ts) — a
                            single job's description is a much thinner corpus than
                            /co's full posting set, so this returns null far more
                            often here; that's the correct, honest behavior, not a
                            bug to work around. */}
                        {aboutLine && (
                            <p className="mt-2 max-w-[640px] text-sm leading-snug text-foreground">&ldquo;{aboutLine}&rdquo;</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-4 sm:gap-6">
                            {showOpenCount && (
                                <div className="min-w-[100px]">
                                    <div className="text-xl font-semibold text-foreground dark:text-white">
                                        {liveOpenCount != null
                                            ? openCountText({ openCount: liveOpenCount.value, openCountIsLowerBound: liveOpenCount.isLowerBound })
                                            : job.company_open_count!.toLocaleString()}
                                    </div>
                                    <div className="mono-data mt-0.5 text-sm text-muted-foreground">
                                        Live roles
                                    </div>
                                </div>
                            )}
                            {typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number" && (
                                <div className="min-w-[120px]">
                                    <div className="text-xl font-semibold text-foreground dark:text-white">
                                        {job.company_opened_90d.toLocaleString()}/{job.company_closed_90d.toLocaleString()}
                                    </div>
                                    <div className="mono-data mt-0.5 text-sm text-muted-foreground">
                                        Opened / closed, 90d
                                    </div>
                                </div>
                            )}
                        </div>
                        {cleanedCompany && (
                            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                                <Link
                                    href={
                                        job.company_domain?.trim()
                                            ? buildCompanyJobsUrl({ domain: job.company_domain.trim() })
                                            : jobCompanyHref(cleanedCompany, job.company_domain)
                                    }
                                    onClick={() => {
                                        if (onClose) onClose();
                                    }}
                                    className="text-sm text-brand hover:underline"
                                >
                                    All jobs at {companyBrand || cleanedCompany}
                                </Link>
                                <Link
                                    href={jobCompanyHref(cleanedCompany, job.company_domain)}
                                    onClick={() => {
                                        if (onClose) onClose();
                                    }}
                                    className="text-sm text-brand hover:underline"
                                >
                                    {companyBrand || cleanedCompany}
                                </Link>
                            </div>
                        )}
                    </div>
                )}

                {/* A2 — "More like this" (Curiosity / Serial Positioning
                    Effect). Zero related → render nothing, no empty shell
                    (see the fetch effect above's error handling too). */}
                {related.length > 0 && (
                    <div className="border-t border-border py-6">
                        <h3 className="mb-2 text-sm font-semibold text-foreground">
                            More like this
                        </h3>
                        {/* Rulebook item h: rows separated only by a hairline,
                            not bordered cards — same divide-y idiom as the SERP
                            list, applied here via RelatedJobRow's own anatomy. */}
                        <div className="divide-y divide-border">
                            {related.map((r) => (
                                <RelatedJobRow
                                    key={r.id}
                                    job={r}
                                    now={now}
                                    onClick={() => onOpenRelated?.(r.id, r)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Footnote position (serp-readout-redesign.html annotation
                    9) — moved from between the description and the company
                    rail; "how you match" reads as an afterthought, not a
                    hiring-truth-rail peer. */}
                {/* `McpHandoffActions` (src/components/mcp/, shared with
                    /yours/[id] — out of this pass's scope) renders its own
                    primary CTA with a `bg-brand` fill; the rulebook allows
                    exactly one filled button per region and Apply above is
                    it, so this second CTA reads as plain Klein text — no
                    fill, no border (rulebook item f) — from this call site
                    only, leaving the shared component and its other mount
                    (which isn't a "detail" region) alone. */}
                <div className="border-t border-border py-6">
                    <McpHandoffNote
                        className="border-0 bg-transparent p-0 [&_button.bg-brand]:!border-0 [&_button.bg-brand]:!bg-transparent [&_button.bg-brand]:!px-0 [&_button.bg-brand]:!text-brand [&_button.bg-brand]:hover:!bg-transparent [&_button.bg-brand]:hover:!underline"
                        job={{
                            id: job.id,
                            title: jobTitle,
                            company: companyBrand || job.company || "Unknown company",
                            location: locationText(job) || null,
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
