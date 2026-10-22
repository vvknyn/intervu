"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { jobPath } from "@/lib/jobs/job-slug";
import { ArrowSquareOut, Check, Minus, SignIn, Warning, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { jobActionSize } from "@/lib/jobs/toolbar-control-height";
import { remoteScope, withRemoteScope } from "@/lib/jobs/remote-scope";
import { ContextHelp } from "@/components/ui/context-help";
import { ShareAction } from "@/components/ui/share-action";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { KpiStat, MetaLine, PostingCheckSignalsGrid } from "@/components/jobs/job-detail-primitives";
import { HiresInLine, hiresNoteOf, RemoteScopeLine } from "@/components/jobs/HiresIn";
import { MatchChip } from "@/components/jobs/MatchChip";
import type { MatchScore } from "@/lib/match/score";
import { useJobViewedCapture } from "@/lib/analytics/use-job-viewed-capture";
import { ReportJobButton } from "@/components/jobs/ReportJobButton";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { TrackedStageLine } from "@/components/jobs/TrackedStageLine";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { buildFactChips, deriveExposureBadges, deriveGhostSignals, ghostCheckedText, alsoInLabel, jobTrackRecord, pairedKpiChips, applyButtonLabel, GHOST_CHECK_TAGLINE } from "@/components/jobs/job-detail-facts";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { jobCompanyHref } from "@/lib/companies/paths";
import { extractCompanyAboutLine } from "@/lib/companies/about-line";
import { cn } from "@/lib/utils";
import { formatDescription } from "@/lib/jobs/format-description";
import { FormattedJobDescription } from "@/components/jobs/JobDescription";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { ghostMetaFor, displayCompany, displayCompanyBrand, locationText, placeWithWorkMode, clampLocationSegments, shortDate, salaryText, postedAgeShort, visibleTags } from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { presentJob } from "@/lib/presentation";
import { STATUS_PILL, LISTING_STATE_TEXT } from "@/lib/ui/status-tokens";
import { PostingCheckSummary } from "@/components/jobs/PostingCheckSummary";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { jobShareUrl } from "@/lib/jobs/share-url";
import { withShareRef } from "@/lib/share/share-decision";
import { type EventSource } from "@/lib/analytics/events";
import { SHARE_JOB_TEXT } from "@/lib/seo/constants";
import { POSTING_AGE_CONTEXT_COPY, isAgeSignal, shouldShowAgeBalanceNote } from "@/lib/jobs/ghost-context-copy";
import { getRelatedJobsAction, getCompanyOpenCountAction } from "@/actions/jobs";
import { shouldSuppressOpenCount, type OpenCount } from "@/lib/companies/open-count";
import { openCountText, buildCompanyJobsUrl } from "@/lib/companies/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { relatedJobsHeading, relatedSeed, type RelatedBasis, type RelatedSeed } from "@/lib/jobs/related-jobs";
import type { Pursuit } from "@/lib/pursuits/types";
import { resolveDescriptionSectionState } from "@/lib/jobs/description-section-state";
import { useDescriptionSettled } from "@/components/jobs/use-description-settled";
import { LocalCustomizePanel } from "@/components/jobs/LocalCustomizePanel";
import { DescriptionLoadingStatus } from "@/components/jobs/for-you/DescriptionLoadingStatus";
import { FitReasons, FitReasonsUploadSlot } from "@/components/jobs/for-you/FitReasons";
import { DotsThree } from "@phosphor-icons/react";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { ResumeData } from "@/types/resume";
import { WaitBar } from "@/components/ui/wait-state";

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

/** The description renderer moved to JobDescription.tsx (with the on-device
 *  layout hook); re-exported for the callers that import it from here. */
export { JobDescription } from "@/components/jobs/JobDescription";

// MetaLine / KpiStat / PostingCheckSignalsGrid live in job-detail-primitives.tsx
// so list rows can use them without pulling this file (and its PDF export
// chain) into the first-load bundle. Re-exported for existing importers.
export { KpiStat, MetaLine, PostingCheckSignalsGrid };

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
    verdictLabel,
    verdictClassName,
    checkedText,
    headingLevel,
}: {
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
                {/* The "N/M favorable · N not tracked" counts that sat here
                    are the chips under this row now (PostingCheckSummary). */}
                <div className="text-sm">
                    <HeadingTag className="inline font-semibold text-foreground">Posting check</HeadingTag>
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
        <div className="overflow-hidden border border-border bg-surface" aria-hidden="true">
            <div className="border-b border-border p-6">
                <div className="flex items-start gap-4">
                    <WaitBar className="h-12 w-12 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <WaitBar className="h-5 w-2/3" />
                        <WaitBar className="h-3.5 w-1/3" />
                        <div className="flex flex-wrap gap-2 pt-1">
                            <WaitBar className="h-5 w-20" />
                            <WaitBar className="h-5 w-24" />
                            <WaitBar className="h-5 w-16" />
                        </div>
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                    <WaitBar className="h-9 w-40" />
                    <WaitBar className="h-9 w-48" />
                    <WaitBar className="h-9 w-32" />
                </div>
            </div>
            <div className="space-y-2 p-6">
                <WaitBar className="h-3.5 w-full" />
                <WaitBar className="h-3.5 w-full" />
                <WaitBar className="h-3.5 w-5/6" />
                <WaitBar className="h-3.5 w-2/3" />
            </div>
        </div>
    );
}

/** The glyph before the Apply label. Signed out the button opens a sign-in
 *  dialog, so it carries the sign-in glyph, not the leaves-this-site arrow. */
export function ApplyButtonIcon({ signedOut, size, weight }: { signedOut: boolean; size?: number; weight?: "bold" }) {
    const Icon = signedOut ? SignIn : ArrowSquareOut;
    return <Icon size={size} weight={weight} />;
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
    saveSuccessPulse = false,
    signedOut = false,
    className,
}: {
    job: PublicJob;
    onOpenPosting: () => void;
    onGoAfter: () => void;
    /** The existing pursuit for this job, if the user already went after it —
     *  same contract as `JobDetail`'s own prop (see there); drives the same
     *  bookmark control rendered inline above. */
    pursuit: Pursuit | undefined;
    saveSuccessPulse?: boolean;
    /** Accepted for callers' sake; the label follows `signedOut`, not this. */
    signedIn?: boolean;
    /** CONFIRMED signed out (`isConfirmedSignedOut`): the button takes the
     *  signed-out label (`APPLY_SIGNED_OUT_LABEL`), which is what a tap opens.
     *  Unknown or signed in keeps the employer-site label, so a signed-in
     *  visitor never sees the sign-in one. */
    signedOut?: boolean;
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
}) {
    return (
        <div
            data-testid="job-detail-action-bar"
            className={cn("sticky bottom-0 z-20 flex h-12 items-center gap-2 border-t border-border bg-surface px-4", className)}
        >
            {job.apply_url && (
                <Button size={jobActionSize} className="flex-1 gap-2 bg-brand text-brand-foreground hover:bg-brand transition-colors" onClick={onOpenPosting}>
                    <ApplyButtonIcon signedOut={signedOut} weight="bold" />
                    {applyButtonLabel(signedOut)}
                </Button>
            )}
            {/* Apply and Save only. The Apply label leaves no room
                for a Customize or Upload button beside it on a phone (the
                row ran 60px past a 390px screen, 2026-09-30); the pane's
                action row and the job page's apply card carry that one. */}
            {/* Same icon-only ghost bookmark as the desktop action row —
                one control, restyled once, not a second hand-copy. */}
            <RowBookmarkButton
                pursuit={pursuit}
                onGoAfter={onGoAfter}
                successPulse={saveSuccessPulse}
            />
        </div>
    );
}

/** The related list as `getRelatedJobsAction` returns it. */
export type RelatedJobs = { jobs: PublicJob[]; basis: RelatedBasis };
export const NO_RELATED: RelatedJobs = { jobs: [], basis: "title" };

const RELATED_REUSE_MS = 30_000;
const relatedRequests = new Map<string, { at: number; request: Promise<RelatedJobs> }>();

/**
 * The related list for a `relatedSeed` key, asked for once per job for a
 * short while. The deferred auth and analytics providers (app/layout.tsx)
 * remount the page as each one loads, so a job page ran this fetch three
 * times per view, up to six searches against the visitor's rate limit
 * (2026-09-30).
 */
export function fetchRelatedJobs(seedKey: string): Promise<RelatedJobs> {
    const now = Date.now();
    const hit = relatedRequests.get(seedKey);
    if (hit && now - hit.at < RELATED_REUSE_MS) return hit.request;
    const request = getRelatedJobsAction(JSON.parse(seedKey) as RelatedSeed);
    relatedRequests.set(seedKey, { at: now, request });
    request.catch(() => relatedRequests.delete(seedKey));
    if (relatedRequests.size > 50) relatedRequests.delete(relatedRequests.keys().next().value!);
    return request;
}

// JobCard's row anatomy: the row is the list's full bleed (the list sits at
// -mx-4, see RelatedJobsSection) with the text inset by `--list-inset`, so the
// hover band and the inset focus ring clear the text; the hairline sits on the
// inner block, aligned with the text. Two lines of text, so it sizes to them:
// a `.ctl-*` step pins a single-line height (32px), which squeezed both lines
// flush against the hairlines and clipped their descenders (2026-09-30).
// rounded-none: KEEP — a full-bleed list row, like JobCard's, not a discrete control.
const RELATED_ROW_CLASS = "group block w-full cursor-pointer rounded-none bg-transparent text-left poster-list-inset-x transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-live";

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
export function RelatedJobRow({ job, now, onClick, href, first = false }: { job: PublicJob; now: number; onClick?: () => void; href?: string; first?: boolean }) {
    const salary = salaryText(job);
    const age = postedAgeShort(derivePostedTs(job), now);
    // placeWithWorkMode, not locationText alone: this row has no adjacent
    // work-type chip (unlike JobCard's SERP row), so it's the only place a
    // remote/hybrid job's work mode can show up.
    const loc = placeWithWorkMode(locationText(job), job.work_type);
    const body = (
        <span className={cn("flex min-w-0 flex-col gap-0.5 py-3", !first && "border-t border-border")}>
            <span data-testid="related-job-title" className="truncate text-meta font-semibold text-foreground group-hover:text-brand transition-colors">{presentJob(job).title}</span>
            <span className="mono-data truncate text-xs text-muted-foreground">
                {displayCompanyBrand(job.company, job.company_domain, job.title) || "Unknown company"}
                {loc ? ` · ${loc}` : ""}
                {age ? ` · ${age}` : ""}
                {salary ? ` · from ${salary}` : ""}
            </span>
        </span>
    );
    // On the job page a row is a link to that job's own page; in the board's
    // pane it's a button that opens the job in the pane.
    if (href) {
        return (
            <Link href={href} data-testid="related-job-row" data-control="row" className={RELATED_ROW_CLASS}>
                {body}
            </Link>
        );
    }
    return (
        <button
            type="button"
            data-testid="related-job-row"
            // A list row, not a button face: J-NAV-38 reads `data-control` to leave it out.
            data-control="row"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick?.();
            }}
            // control-type-allow: a full-width list row (title + meta lines), not a button face
            // control-scale-allow: full-width list row, padding is layout
            className={RELATED_ROW_CLASS}
        >
            {body}
        </button>
    );
}

/**
 * The "More like this" block, shared by the board's detail pane (below) and
 * the job page (JobDetailDocument.tsx) so the two can't drift: the heading
 * says which list it is (`relatedJobsHeading`), and rows are separated only
 * by a hairline, not bordered cards (rulebook item h). Zero rows → nothing,
 * no empty shell: the list is an accelerant, never a source of error.
 */
export function RelatedJobsSection({
    jobs,
    basis,
    companyBrand,
    now,
    onOpenRelated,
    linkToPages = false,
    headingLevel: Heading = "h3",
}: {
    jobs: PublicJob[];
    basis: RelatedBasis;
    companyBrand: string | null | undefined;
    now: number;
    onOpenRelated?: (jobId: string, job?: PublicJob) => void;
    /** The job page's rows link to each job's own page, so a click stays on
     *  job pages (it used to drop into the board) and each row can open in a
     *  new tab. The pane's rows open the job in the pane instead. */
    linkToPages?: boolean;
    /** h2 on the job page (a section of the document), h3 inside the pane. */
    headingLevel?: "h2" | "h3";
}) {
    if (jobs.length === 0) return null;
    return (
        <div data-testid="job-detail-related" className="border-t border-border py-6">
            <Heading className="mb-2 text-sm font-semibold text-foreground">{relatedJobsHeading(basis, companyBrand)}</Heading>
            {/* -mx-4 undoes the pane's and the page column's 16px inset so
                each row's hover band runs edge to edge (RelatedJobRow). */}
            <div className="-mx-4">
                {jobs.map((r, i) => (
                    <RelatedJobRow
                        key={r.id}
                        job={r}
                        now={now}
                        first={i === 0}
                        href={linkToPages ? jobPath(r) : undefined}
                        onClick={() => onOpenRelated?.(r.id, r)}
                    />
                ))}
            </div>
        </div>
    );
}

export function JobDetail({
    job,
    now,
    source,
    onOpenPosting,
    onGoAfter,
    pursuit,
    saveSuccessPulse = false,
    variants = [],
    onClose,
    className,
    signedIn = true,
    signedOut = false,
    onOpenRelated,
    reportJobEnabled = false,
    collapseDescription = true,
    actionBarBelow = false,
    matchScore = null,
    matchAsOfDate = null,
    matchPending = false,
    descriptionPending,
    onRetryDescription,
    resume = null,
    onUploadResume,
    onSignInToSync,
    onSkip,
}: {
    job: PublicJob;
    /** Single per-render-pass "now" from JobsContent — see the `nowMs` comment there. */
    now: number;
    /** Where this panel was opened from — fires `job_viewed` once per job.id mount. */
    source: EventSource;
    onOpenPosting: () => void;
    /** When false, Apply/Save gate at click; description body stays public. */
    signedIn?: boolean;
    /** CONFIRMED signed out: Apply takes the signed-out label (see
     *  `JobDetailActionBar`). Not derivable from `signedIn`, which is also
     *  false while the session check is still running. */
    signedOut?: boolean;
    /** ITEM O-FE (2026-08-15) — probed once by the caller via
     *  `reportJobEnabledAction`; the flags endpoint isn't deployed yet, so
     *  this defaults to hidden rather than showing a button that 404s. */
    reportJobEnabled?: boolean;
    /** Accepted-but-unused (prep surface removed 2026-08-02): kept optional
     *  so callers built before the removal — e.g. app/page.tsx, out of this
     *  change's scope — still typecheck without editing their call sites. */
    onPrep?: () => void;
    onGoAfter: () => void;
    /** The existing pursuit for this job, if the user already went after it. */
    pursuit: Pursuit | undefined;
    saveSuccessPulse?: boolean;
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
    /** The caller renders `JobDetailActionBar` right below this pane (the
     *  phone sheets), so Apply and Save are already on screen there: the
     *  action row drops its own pair rather than show two Apply buttons in
     *  two styles and two bookmarks (2026-10-02). Same split the job page
     *  makes below lg (JobDetailDocument's `applyCardEl`). */
    actionBarBelow?: boolean;
    /** `scoreJobAgainstResume`'s output for this job, or `null` when there's
     *  no signed-in résumé or no comparable field — renders no chip, never a
     *  fabricated 0 (Rule 3, match-contract.md). Same value the SERP card and
     *  `sort=fit` read, computed once by the shared `PublicJobDetail` mount. */
    matchScore?: MatchScore | null;
    /** The résumé's stored update date, pre-formatted (`shortDate(...).toLowerCase()`) — the receipt's "against your résumé of {date}" line. */
    matchAsOfDate?: string | null;
    /** When true, defer `job_viewed` until auth + résumé reads settle (PublicJobDetail). */
    matchPending?: boolean;
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
    onUploadResume?: () => void;
    onSignInToSync?: () => void;
    /** Wired to the existing skip/hide mechanism (`useForYouDeck`'s
     *  `handleSkip`) — present only on the For-you ranked-results surface.
     *  Renders a quiet overflow (⋯) menu next to Close with one "Hide" item;
     *  omitted entirely (no menu at all) on every other mount site. */
    onSkip?: () => void;
}) {
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
    useJobViewedCapture({ job, source, signedIn, matchPending, matchScore, resume });
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
    // A plain "Remote" reads "Remote (Canada)" when its posting limits it to a place its fields leave out (remote-scope.ts).
    const scope = remoteScope(job);
    const locationDisplay = withRemoteScope(presented.location, scope);
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
    // Gate for every below-the-fold fetch this panel makes (related jobs,
    // company open count): true once the description has settled (ready or
    // confirmed empty), flipped in a `useEffect` so it lands strictly after
    // the render that painted the description — see use-description-settled.ts.
    const descriptionSettled = useDescriptionSettled({ description: job.description, descriptionPending });
    // Long descriptions are clamped behind a "Show more" toggle so the sticky
    // detail panel doesn't run thousands of pixels tall. `collapseDescription`
    // (default true) is the seam that turns this off for mount sites that
    // already provide their own scroller — see its doc comment above.
    const collapsible = collapseDescription && (job.description?.length ?? 0) > 700;
    // Structured facts grid (cards pass, 2026-09-17) — each cell renders only
    // when buildFactChips already decided the underlying field is present;
    // see that function's own per-field include/omit decision (kept pure +
    // unit-tested there) rather than re-deriving presence in this component.
    const chips = buildFactChips(job, postedRelative, firstSeenRelative);
    const workTypeChip = chips.find((c) => c.kind === "work_type");
    const employmentTypeChip = chips.find((c) => c.kind === "employment_type");
    const experienceLevelChip = chips.find((c) => c.kind === "experience_level");
    const postedChip = chips.find((c) => c.kind === "posted");
    const firstSeenChip = chips.find((c) => c.kind === "first_seen");
    // Same `clusters`-derived variants prop the SERP row's own "also in"
    // chip reads (page.tsx's `detailVariants`) — not a second lookup.
    const alsoIn = alsoInLabel(job, variants);
    const salary = salaryText(job);
    // `cleanedCompany` keeps its legal suffix (e.g. "Qualys, Inc.") — it
    // feeds `jobCompanyHref` below, which uses it to build the `/companies/`
    // slug when the job has no `company_domain`, so it can't move to the
    // brand form without moving the slug too. `companyBrand` is the reader-
    // facing text (header, hiring-record heading, MCP handoff copy) — same
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
    // EXPANDED ghost module (docs-mockup.html Comp B2) — honest, derived
    // signal list; see deriveGhostSignals's doc comment for why each line
    // reuses an existing single source instead of new inferred logic.
    const ghostSignals = deriveGhostSignals(job, freshness, blocks.length, now);
    // Pay card visibility reuses the SAME pay signal the posting-check card
    // renders below — one disclosure boolean, not a second, independently
    // derived `Boolean(salary)` guess that could disagree with the ledger.
    const payDisclosed = ghostSignals.find((s) => s.kind === "pay")?.status === "favorable";
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
    const [related, setRelated] = useState<RelatedJobs>(NO_RELATED);
    // Keyed by a string, not the job object or `job.location_country` (it
    // can be an array): a fresh object per render would re-run the fetch.
    const relatedKey = JSON.stringify(relatedSeed(job));
    useEffect(() => {
        // Below-the-fold: waits for the description to settle (ready or
        // confirmed empty — see use-description-settled.ts) so this fetch
        // never races the description paint.
        if (!descriptionSettled) return;
        let cancelled = false;
        setRelated(NO_RELATED);
        // Guests see this list gated behind sign-in — fetching for them would
        // spend up to two corpus queries per detail-open on rows nobody can
        // read. The open-count figure below is fetched separately and does
        // NOT share this gate — see that effect's own comment for why.
        if (!signedIn) return;
        fetchRelatedJobs(relatedKey)
            .then((data) => {
                if (cancelled) return;
                setRelated(data);
            })
            .catch(() => {
                // "More like this" is an accelerant, never a source of
                // user-visible error — the render guard below already
                // renders nothing for an empty list.
            });
        return () => {
            cancelled = true;
        };
    }, [relatedKey, signedIn, descriptionSettled]);

    // ITEM N (2026-08-15), decoupled from sign-in 2026-08-20 — the
    // hiring-record rail's "Live roles" figure used to read
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
        // Below-the-fold: same settle gate as the related-jobs effect above
        // — see use-description-settled.ts.
        if (!descriptionSettled) return;
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
    }, [job.company_domain, descriptionSettled]);

    // Resolve to ONE open-count number the same way the render below reads
    // it (live figure first, stale field as fallback), then run it through
    // `shouldSuppressOpenCount` so a company whose live count is honestly 0
    // never renders "0 live roles" on a page that is itself one of that
    // company's live postings — see that function's doc comment for the
    // closed-job carve-out.
    const resolvedOpenCount =
        liveOpenCount != null ? liveOpenCount.value : typeof job.company_open_count === "number" ? job.company_open_count : null;
    const showOpenCount = resolvedOpenCount != null && !shouldSuppressOpenCount(resolvedOpenCount, job.vacancy_status === "closed");

    const trackRecord = jobTrackRecord(job);
    const hasCompanyIntel = showOpenCount || trackRecord != null;

    return (
        <div
            data-region="detail"
            className={cn(
                // rounded-none: KEEP — edge-to-edge content region nested inside
                // already-rounded ancestors (detail-pane wrapper / Sheet).
                "relative rounded-none bg-transparent",
                collapseDescription && "flex min-h-0 flex-1 flex-col overflow-hidden",
                className,
            )}
        >
            {/* Identity block — pinned outside the scroll subtree when the pane
                owns scrolling (flex split); the mobile sheet keeps everything
                in one flow and passes collapseDescription={false}. Cards pass
                (2026-09-17): company row / title / actions each get their own
                row instead of one dense identity paragraph. The panel's own
                grey fill and radius belong to the surfaces PR (jobs/page.tsx)
                — this div and everything under it stays a plain flex column
                on that background, no card of its own. */}
            <div className="shrink-0">
                {/* Company row — logo, name, domain-as-link only; every other
                    fact (location, work type, pay, dates) lives in the facts
                    grid below, not here. A "‹ 1 of N ›" pager belongs on this
                    row's right side per the mock, but JobDetail receives no
                    selected-index/count/prev-next props to drive one — see
                    the PR description for that follow-up; rendering a pager
                    with no working prev/next would be a dead control. */}
                <div className="flex items-center gap-3 px-4 pt-4 sm:px-6">
                    <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-foreground">{companyBrand || "Unknown company"}</div>
                        {cleanedCompany && job.company_domain && (
                            <Link
                                href={jobCompanyHref(cleanedCompany, job.company_domain)}
                                className="block truncate text-sm text-muted-foreground hover:underline"
                            >
                                {job.company_domain}
                            </Link>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
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
                                        className="ctl-md ctl-button ctl-square flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    />
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">Copy link</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        {onSkip && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label="More actions"
                                        className="ctl-md ctl-button ctl-square flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    >
                                        <DotsThree size={20} weight="bold" aria-hidden />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem data-testid="job-detail-hide" onSelect={onSkip}>
                                        Hide
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        {onClose && (
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={onClose}
                                className="ctl-md ctl-button ctl-square flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X size={16} aria-hidden />
                            </button>
                        )}
                    </div>
                </div>

                {/* Title row */}
                <div className="px-4 pb-3 pt-3 sm:px-6">
                    {/* page-scale-allow: a job's title heads its detail pane at the page-title step; the h1 is the list masthead */}
                    <h2 className="font-display text-2xl font-semibold leading-tight text-balance text-foreground">{jobTitle}</h2>
                    {matchScore && (
                        <div className="mt-2">
                            <MatchChip score={matchScore} asOfDate={matchAsOfDate} jobId={job.id} />
                        </div>
                    )}
                    {/* A remote role whose posting says it hires in the candidate's country: the word and the posting's own line. */}
                    {hiresNoteOf(matchScore) ? <HiresInLine note={hiresNoteOf(matchScore)!} /> : scope && <RemoteScopeLine scope={scope} />}
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
                </div>

                {/* Action row */}
                <div className="px-4 pb-4 sm:px-6">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* House attention system (docs/design/ATTENTION.md,
                            channel 2): exactly one inverted-ink block per
                            view. Apply is the primary action this pane
                            exists for — an inverted-ink fill (bg-foreground/
                            text-background), not the quietest element on
                            the page. Save is the secondary action: an
                            outlined control. rounded-ctl on both, same as
                            every other control in this row. */}
                        {job.apply_url && !actionBarBelow && (
                            <Button size={jobActionSize} onClick={onOpenPosting} className="gap-2 px-4 bg-foreground text-background transition-colors">
                                <ApplyButtonIcon signedOut={signedOut} size={16} />
                                {applyButtonLabel(signedOut)}
                            </Button>
                        )}
                        {resume != null ? (
                            <LocalCustomizePanel
                                job={job}
                                resume={resume}
                                signedIn={signedIn}
                                onSignInToSync={onSignInToSync}
                            />
                        ) : null}
                        {/* RowBookmarkButton is a fixed-size icon-only square
                            control (no text-label prop) — `rounded-ctl` plus
                            an outline matches every other control in this
                            row (Apply, Share, Close) rather than a bespoke
                            shape. */}
                        {!actionBarBelow && (
                            <RowBookmarkButton
                                pursuit={pursuit}
                                onGoAfter={onGoAfter}
                                successPulse={saveSuccessPulse}
                                className="rounded-ctl border border-border bg-surface"
                            />
                        )}
                        {/* ReportJobButton hardcodes its own trigger content
                            (flag icon + "Report listing" text, ReportJobButton.tsx)
                            with no prop to swap in a "···" overflow glyph — that
                            restyle would require editing that shared,
                            out-of-scope component, so this keeps its existing
                            rendered form, still pinned to the far right via its
                            own `ml-auto`. */}
                        {reportJobEnabled && job.apply_url && (
                            <ReportJobButton
                                jobId={job.id}
                                jobUrl={job.apply_url}
                                jobTitle={jobTitle}
                                className="ml-auto"
                            />
                        )}
                    </div>
                    <TrackedStageLine pursuit={pursuit} nowMs={now} className="mt-3" />
                </div>
            </div>

            <div
                className={cn(
                    "px-4 pb-6 pt-4",
                    collapseDescription && "min-h-0 flex-1 overflow-y-auto custom-scrollbar",
                )}
            >
                {/* Facts grid (cards pass, 2026-09-17) — one cell per fact
                    buildFactChips already decided is present, replacing the
                    old single dotted meta line. Icons reuse the same
                    FACT_CHIP_ICON map the SERP row's own chips use, so a
                    fact never gets a second, diverging glyph here. */}
                <div className="grid grid-cols-1 gap-x-6 gap-y-2 pb-4 text-sm sm:grid-cols-2">
                    {location && (
                        <div className="flex items-start gap-2 text-foreground">
                            <FACT_CHIP_ICON.location size={16} weight="bold" className="relative top-0.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="inline-flex flex-col">
                                {locationClamped ? (
                                    <>
                                        {(locationExpanded
                                            ? [...locationDisclosure.visible, ...locationDisclosure.hidden]
                                            : locationDisclosure.visible
                                        ).map((segment, i) => (
                                            <span key={i} data-testid="job-location">{segment}</span>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setLocationExpanded((v) => !v)}
                                            className="mt-0.5 text-left text-xs text-brand hover:underline cursor-pointer"
                                        >
                                            {locationExpanded ? "Show less" : `+ ${locationDisclosure.hidden.length} more locations`}
                                        </button>
                                    </>
                                ) : (
                                    <span data-testid="job-location">{locationDisplay}</span>
                                )}
                                {/* Review fix: `variants` (page.tsx's
                                    `detailVariants`, same clusters the SERP
                                    row groups on) went unread once the old
                                    dotted meta line was removed — restored
                                    as its own line under location via the
                                    shared MetaLine seam, rather than a raw
                                    span, per reuse-before-write. */}
                                {alsoIn && (
                                    <span className="mt-0.5 text-xs text-muted-foreground">
                                        <MetaLine items={[`also in ${alsoIn}`]} />
                                    </span>
                                )}
                            </span>
                        </div>
                    )}
                    {workTypeChip && (
                        <div className="flex items-center gap-2 text-foreground">
                            <FACT_CHIP_ICON.work_type size={16} weight="bold" className="shrink-0 text-muted-foreground" aria-hidden />
                            <span>{workTypeChip.label}</span>
                        </div>
                    )}
                    {(employmentTypeChip || experienceLevelChip) && (
                        <div className="flex items-center gap-2 text-foreground">
                            <FACT_CHIP_ICON.employment_type size={16} weight="bold" className="shrink-0 text-muted-foreground" aria-hidden />
                            {/* One flex item: as the row's own items, the row's
                                gap-2 landed after the "·" ("Part Time ·   Mid"). */}
                            <span>
                                <MetaLine
                                    items={[
                                        employmentTypeChip && <span>{employmentTypeChip.label}</span>,
                                        experienceLevelChip && <span>{experienceLevelChip.label}</span>,
                                    ]}
                                />
                            </span>
                        </div>
                    )}
                    {(postedChip || firstSeenChip) && (
                        <div className="flex items-center gap-2 text-foreground">
                            <FACT_CHIP_ICON.posted size={16} weight="bold" className="shrink-0 text-muted-foreground" aria-hidden />
                            <span>
                                {postedChip && (
                                    <span className={freshness.kind === "relisted" ? LISTING_STATE_TEXT.relisted : undefined}>{postedChip.label}</span>
                                )}
                                {firstSeenChip && (
                                    <span className="text-xs text-muted-foreground">
                                        {postedChip ? " · " : ""}{firstSeenChip.label}
                                    </span>
                                )}
                            </span>
                            {postedChip && firstSeenChip && (
                                <ContextHelp
                                    content="Employer posted is the date on their listing. First seen by us is when our crawler actually found it — a relist can reset the employer's date without the role being new."
                                    className="self-center"
                                />
                            )}
                        </div>
                    )}
                    {/* Review fix: report_count is a retrieved Meili
                        attribute (meilisearch.ts's fetch fields), not a
                        buildFactChips kind — rowExceptionMark doesn't cover
                        it either. Same gate + wording as the pre-restyle
                        line, reused verbatim rather than rephrased. */}
                    {typeof job.report_count === "number" && job.report_count > 0 && (
                        <div className="flex items-center gap-2 text-warn">
                            <span>
                                reported {job.report_count} {job.report_count === 1 ? "user" : "users"}
                            </span>
                        </div>
                    )}
                </div>

                {/* Pay card — gated on the SAME pay signal the posting-check
                    ledger renders below, never a second, independently
                    derived guess at whether pay is shown. White fill: this
                    card sits on the panel's own grey background (surfaces
                    PR, jobs/page.tsx), not on white. rounded-panel (16px)
                    per the semantic radius tokens (surfaces PR #537). */}
                {payDisclosed && salary && (
                    <div data-tour="jobs-pay" className="mb-4 rounded-panel bg-surface px-4 py-3.5">
                        <div className="flex flex-wrap items-baseline gap-3">
                            <span className="text-sm font-semibold text-muted-foreground">Pay</span>
                            <span className="font-display text-xl font-semibold tabular-nums text-foreground">{salary}</span>
                            <span className="text-xs text-muted-foreground">disclosed in the posting</span>
                        </div>
                    </div>
                )}

                {/* Why this fits (mock B5) — same MatchChip already mounted in
                    the title row, reused (never a second "Fit N" pill). Gated
                    on the same `matchScore` presence check as that chip. */}
                {matchScore ? (
                    <FitReasons job={job} score={matchScore} asOfDate={matchAsOfDate} resume={resume} jobId={job.id} />
                ) : resume == null && onUploadResume ? (
                    <FitReasonsUploadSlot onUploadResume={onUploadResume} />
                ) : null}

                {/* Posting check (rulebook item e): white card on the panel's
                    grey fill (rounded-panel, no border) — same header/
                    signals-grid/footer as before, only the container gained
                    a fill. Same 16px token as the Pay card above. */}
                {ghost && (
                    <div data-tour="jobs-posting-check" className="mb-6 rounded-panel bg-surface p-4">
                        <PostingCheckHeader
                            verdictLabel={ghost.label}
                            verdictClassName={ghost.cls.split(" ").find((c) => c.startsWith("text-")) ?? ""}
                            checkedText={checkedText}
                            headingLevel={3}
                        />
                        <PostingCheckSummary signals={ghostSignals} relisted={freshness.kind === "relisted"}>
                            <div className="pt-2 text-sm text-muted-foreground">{ghost.explain}</div>
                            {ghostSignals.length > 0 && (
                                <PostingCheckSignalsGrid>
                                    {ghostSignals.map((s) => {
                                        const relistCaution = s.kind === "freshness" && freshness.kind === "relisted";
                                        return (
                                        <div key={s.text} className="flex items-start gap-2">
                                            {/* Three glyphs for two real states: a "not tracked"
                                                row renders no glyph at all (rulebook item e), not
                                                the old shared "·" that read as a real (if neutral)
                                                finding. */}
                                            <span
                                                className={cn(
                                                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-sm font-semibold",
                                                    relistCaution ? LISTING_STATE_TEXT.relisted : s.status === "favorable" ? "text-live" : "text-muted-foreground",
                                                )}
                                                aria-hidden={s.status !== "unknown"}
                                            >
                                                {relistCaution ? (
                                                    <Warning size={16} weight="bold" />
                                                ) : s.status === "favorable" ? (
                                                    <Check size={16} weight="bold" />
                                                ) : s.status === "unfavorable" ? (
                                                    <Minus size={16} weight="bold" />
                                                ) : null}
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
                            {/* WHEN this verdict was last checked is in the header
                                above; this says how. */}
                            <div className="pt-3 text-xs text-muted-foreground">{GHOST_CHECK_TAGLINE}</div>
                        </PostingCheckSummary>
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
                )}

                {/* The ghost-check ledger and description body render for
                    everyone — posting text is public; Apply stays gated. */}
                {/* Rulebook item d: sections stack on page bg, separated by a
                    hairline top border + 24px vertical padding — no card/panel
                    per section. Body copy sits at a max-w-prose reading measure. */}
                <div className="border-t border-border py-6">
                    <h3 className="mb-2 text-sm font-semibold text-foreground">About this role</h3>
                    {(() => {
                        // The employer's-site-is-slow note — shared by the "body" case
                        // (teaser stub still showing while the fill runs) and the
                        // "pending" case (nothing to show yet at all). Single element
                        // with a conditional lead sentence rather than two near-
                        // identical paragraphs.
                        const pendingNote = (previewLead: boolean) => (
                            <p className="max-w-prose text-base leading-relaxed text-foreground">
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
                                            className={cn("relative max-w-prose", collapsible && !descExpanded && "max-h-[20rem] overflow-hidden")}
                                        >
                                            <FormattedJobDescription description={job.description} headingLevel={4} />
                                            {collapsible && !descExpanded && (
                                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
                                            )}
                                        </div>
                                        {collapsible && (
                                            <button
                                                type="button"
                                                onClick={() => setDescExpanded((v) => !v)}
                                                className="mt-2 text-sm text-foreground underline underline-offset-2 cursor-pointer"
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
                                            <WaitBar className="h-3.5 w-full" />
                                            <WaitBar className="h-3.5 w-full" />
                                            <WaitBar className="h-3.5 w-5/6" />
                                        </div>
                                        <div className="mt-3">
                                            <DescriptionLoadingStatus />
                                        </div>
                                    </>
                                );
                            case "pending":
                                return pendingNote(false);
                            case "empty":
                            default:
                                return (
                                    <p className="max-w-prose text-base leading-relaxed text-foreground">
                                        No description was captured for this role.{" "}
                                        {job.apply_url ? (
                                            <>
                                                Use{" "}
                                                <span className="font-semibold text-foreground">
                                                    {applyButtonLabel(signedOut)}
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

                {visibleTags(job.tags, 16).length > 0 && (
                    <div className="border-t border-border py-6">
                        {/* Rulebook item c: no bordered tag chips — a sentence-case
                            label plus one flowing secondary line joined by " · ". */}
                        <div className="mb-1 text-sm font-semibold text-foreground">Keywords from the posting</div>
                        <div className="mono-data text-sm text-muted-foreground">
                            {visibleTags(job.tags, 16).join(" · ")}
                        </div>
                    </div>
                )}

                {/* Company hiring mini-KPI rail (rulebook item g): keep
                    content, render on page bg with a hairline top divider
                    instead of a bordered/bg panel. */}
                {hasCompanyIntel && (
                    <div className="border-t border-border py-6">
                        <h3 className="text-base font-semibold text-foreground">
                            {companyBrand || "This company"} · hiring record
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
                                <KpiStat
                                    value={
                                        liveOpenCount != null
                                            ? openCountText({ openCount: liveOpenCount.value, openCountIsLowerBound: liveOpenCount.isLowerBound })
                                            : job.company_open_count!.toLocaleString()
                                    }
                                    label="Live roles"
                                />
                            )}
                            {trackRecord &&
                                pairedKpiChips(trackRecord).map((chip) => (
                                    <KpiStat key={chip.label} value={chip.value} label={chip.label} minWidthClassName="min-w-[110px]" />
                                ))}
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
                                {/* The company page (/co/[slug]) — only with a
                                    domain: without one, "All jobs at" above
                                    already points at this same URL. Named for
                                    where it goes; a bare company name beside
                                    "All jobs at {brand}" read as a duplicate. */}
                                {job.company_domain?.trim() && (
                                    <Link
                                        href={jobCompanyHref(cleanedCompany, job.company_domain)}
                                        onClick={() => {
                                            if (onClose) onClose();
                                        }}
                                        className="text-sm text-brand hover:underline"
                                    >
                                        {companyBrand || cleanedCompany} company page
                                    </Link>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* A2 — "More like this" (Curiosity / Serial Positioning
                    Effect). Zero related → render nothing, no empty shell
                    (see the fetch effect above's error handling too). */}
                <RelatedJobsSection
                    jobs={related.jobs}
                    basis={related.basis}
                    companyBrand={companyBrand}
                    now={now}
                    onOpenRelated={onOpenRelated}
                />

                {/* Footnote position (serp-readout-redesign.html annotation
                    9) — moved from between the description and the company
                    rail; "how you match" reads as an afterthought, not a
                    hiring-record-rail peer. */}
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
