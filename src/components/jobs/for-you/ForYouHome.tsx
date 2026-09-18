"use client";

/**
 * For you — ranked results (mock B5, 2026-09-18 rebuild). Same list+detail
 * primitives Search uses (`JobCard`, `JobDetail`) instead of a parallel deck
 * surface: rows ranked by fit with a `MatchChip` pill (via `JobCard`'s own
 * `matchScore` prop), a "Why this fits" card in the detail (`FitReasons`,
 * mounted inside `JobDetail` itself whenever `matchScore` is present — see
 * JobDetail.tsx:1025). No tab strip, no "N of M" pager, no Replace button,
 * no grey header card, no FIT BREAKDOWN panel — those all die with
 * `ForYouDeck`/`ForYouPack`, deleted alongside this rewrite.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { chipVariants } from "@/components/ui/chip";
import { Sheet, SheetContent, SheetHandle, SheetTitle } from "@/components/ui/sheet";
import { JobCard } from "@/components/jobs/JobCard";
import { JobDetail, JobDetailSkeleton } from "@/components/jobs/JobDetail";
import { ForYouToggle } from "@/components/jobs/for-you/ForYouToggle";
import { fetchAgentPreferencesAction } from "@/actions/agent-preferences";
import { buildPreferenceChips } from "@/lib/jobs/for-you/preference-chips";
import { resolveDeckShortcut } from "@/lib/jobs/for-you/deck-keyboard";
import { resolveDescriptionHydration } from "@/lib/jobs/for-you/description-pane-state";
import { prefetchIndexesAhead } from "@/lib/jobs/for-you/deck-active-job";
import { formatRelativeAge, isStale, RESULT_LINE_FRESH_MS } from "@/lib/jobs/freshness";
import { toolbarChipClass } from "@/lib/jobs/toolbar-control-height";
import { decodeText, displayCompanyBrand } from "@/lib/jobs/presentation";
import { jobPath } from "@/lib/jobs/job-slug";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { Pursuit } from "@/lib/pursuits/types";
import type { ResumeData } from "@/types/resume";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";
import { cn } from "@/lib/utils";

/** Fills the jobs-page viewport shell — unchanged from the pre-rebuild
 *  component; page.tsx's mount site already keys off this exported name. */
export const FOR_YOU_HOME_FRAME_CLASS =
    "flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none";

/** How many cards ahead of the active one to prefetch descriptions for.
 *  Carried over verbatim from the deleted `ForYouDeck.tsx` (this component
 *  is now its only consumer) — `prefetchIndexesAhead` (deck-active-job.ts)
 *  is the pure bound; this is just the number. */
const PREFETCH_AHEAD = 3;

export interface ForYouHomeProps {
    visiblePacks: PublicJob[];
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
    activeJob: PublicJob | null;
    onSkip: () => void;
    matchScores: Map<string, MatchScore | null> | null;
    matchAsOfDate: string | null;
    resume: ResumeData | null;
    nowMs: number;
    /** Freshness stamp for the ranked population — same input
     *  `searchResultLine` takes on the Search surface (page.tsx's
     *  `lastUpdated`), reused via the same `freshness.ts` primitives so both
     *  headers describe "how current" identically. */
    lastUpdated: string | null | undefined;
    fitResolving: boolean;
    loading: boolean;
    fitActive: boolean;
    hydratedJobs: Map<string, { job: PublicJob; descriptionPending: boolean }>;
    onActivePackChange: (jobId: string) => void;
    onOpenPosting: (job: PublicJob) => void;
    homeView: JobsHomeView;
    onHomeViewChange: (view: JobsHomeView) => void;
    showToggle: boolean;
    signedIn: boolean;
    onRequestSignIn: () => void;
    pursuitsByJobId: Map<string, Pursuit>;
    onGoAfter: (job: PublicJob) => void;
    goingAfterId: string | null;
    reportJobEnabled: boolean;
    reportDialogOpen: boolean;
    onReportDialogOpenChange: (open: boolean) => void;
    onAcceptLocalTailor: (data: ResumeData) => void;
}

/** Loading placeholder shaped like the real two-panel frame below (list rows
 *  left, `JobDetailSkeleton` — the SAME skeleton Search's own loading pane
 *  uses — right) so the surface never jumps to a different "card shape"
 *  once results resolve. */
function ForYouLoadingSkeleton() {
    return (
        <div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-[minmax(0,37%)_minmax(0,63%)] xl:gap-4">
            <div className="hidden xl:order-2 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden xl:rounded-panel xl:border xl:border-border xl:bg-card">
                <div className="p-4">
                    <JobDetailSkeleton />
                </div>
            </div>
            <div
                data-testid="for-you-loading"
                className="flex min-h-0 flex-1 flex-col rounded-panel border border-border bg-card xl:min-w-0"
            >
                {[0, 1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        className="flex items-center gap-3 border-b border-border px-[var(--list-inset)] py-4 last:border-b-0"
                    >
                        <Skeleton className="size-10 shrink-0 rounded-pill" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-4 w-2/3" />
                            <Skeleton className="h-3 w-1/3" />
                        </div>
                        <Skeleton className="h-6 w-14 shrink-0" />
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ForYouHome({
    visiblePacks,
    activeIndex,
    onActiveIndexChange,
    activeJob,
    onSkip,
    matchScores,
    matchAsOfDate,
    resume,
    nowMs,
    lastUpdated,
    fitResolving,
    loading,
    fitActive,
    hydratedJobs,
    onActivePackChange,
    onOpenPosting,
    homeView,
    onHomeViewChange,
    showToggle,
    signedIn,
    onRequestSignIn,
    pursuitsByJobId,
    onGoAfter,
    goingAfterId,
    reportJobEnabled,
    reportDialogOpen,
    onReportDialogOpenChange,
    onAcceptLocalTailor,
}: ForYouHomeProps) {
    const router = useRouter();
    const isXlUp = useMediaQuery("(min-width: 1280px)");
    const [mobileOpen, setMobileOpen] = useState(false);

    const [prefsChips, setPrefsChips] = useState(() =>
        buildPreferenceChips({ search: {}, resume, fitFacets: {} }),
    );
    useEffect(() => {
        void (async () => {
            const res = await fetchAgentPreferencesAction();
            const search = res.data?.search ?? {};
            setPrefsChips(buildPreferenceChips({ search, resume, fitFacets: {} }));
        })();
    }, [resume]);

    const showLoading = fitResolving || loading || !fitActive;
    const canNavigate = !showLoading && visiblePacks.length > 0;

    const selectIndex = useCallback(
        (index: number) => {
            onActiveIndexChange(index);
            if (!isXlUp) setMobileOpen(true);
        },
        [onActiveIndexChange, isXlUp],
    );

    // Lookahead prefetch — the active job plus the next `PREFETCH_AHEAD`
    // (`prefetchIndexesAhead`, deck-active-job.ts) — moved here from the
    // deleted `ForYouDeck.tsx`'s own effect, since this component is now the
    // deck's one owner. Guarded on `canNavigate` so this never fires
    // prefetches against a loading/empty `visiblePacks`.
    useEffect(() => {
        if (!canNavigate) return;
        if (activeJob) onActivePackChange(activeJob.id);
        for (const index of prefetchIndexesAhead(activeIndex, visiblePacks.length, PREFETCH_AHEAD)) {
            const ahead = visiblePacks[index];
            if (ahead) onActivePackChange(ahead.id);
        }
    }, [canNavigate, activeJob, activeIndex, visiblePacks, onActivePackChange]);

    // Document-level while For-you is mounted, same idiom as before the
    // rewrite — bundled into one ref so the listener (registered once)
    // always reads the latest values without re-subscribing every render.
    const shortcutStateRef = useRef({ activeIndex, packsLength: visiblePacks.length, canNavigate });
    shortcutStateRef.current = { activeIndex, packsLength: visiblePacks.length, canNavigate };

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const { activeIndex, packsLength, canNavigate } = shortcutStateRef.current;
            if (!canNavigate) return;
            const action = resolveDeckShortcut({
                key: event.key,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey,
                defaultPrevented: event.defaultPrevented,
                target: event.target,
            });
            if (action === "previous") {
                onActiveIndexChange(Math.max(activeIndex - 1, 0));
            } else if (action === "next") {
                onActiveIndexChange(Math.min(activeIndex + 1, packsLength - 1));
            } else if (action === "skip") {
                onSkip();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onActiveIndexChange, onSkip]);

    // Honest hydration read — never a `?? false` stand-in for "not pending"
    // (see description-pane-state.ts's own doc comment: a missing
    // `hydratedJobs` entry means the fetch hasn't resolved OR was never
    // dispatched, not that the job has no description).
    const hydrated = activeJob ? resolveDescriptionHydration(activeJob, hydratedJobs.get(activeJob.id)) : null;
    const detailJob = hydrated?.job ?? null;

    const renderDetail = (onClose: (() => void) | undefined, collapseDescription = true) =>
        detailJob ? (
            <JobDetail
                key={detailJob.id}
                job={detailJob}
                now={nowMs}
                source="serp"
                signedIn={signedIn}
                onRequestSignIn={onRequestSignIn}
                onOpenPosting={() => onOpenPosting(detailJob)}
                onGoAfter={() => onGoAfter(detailJob)}
                onOpenRelated={(_, related) => related && router.push(jobPath(related))}
                pursuit={pursuitsByJobId.get(detailJob.id)}
                goingAfter={goingAfterId === detailJob.id}
                onClose={onClose}
                reportJobEnabled={reportJobEnabled}
                reportDialogOpen={reportDialogOpen}
                onReportDialogOpenChange={onReportDialogOpenChange}
                collapseDescription={collapseDescription}
                className="border-0 bg-transparent"
                descriptionPending={hydrated?.descriptionPending ?? false}
                resume={resume}
                onAcceptLocalTailor={onAcceptLocalTailor}
                matchScore={matchScores?.get(detailJob.id) ?? null}
                matchAsOfDate={matchAsOfDate}
                onSkip={onSkip}
            />
        ) : null;

    const freshnessSuffix =
        lastUpdated && !isStale(lastUpdated, nowMs, RESULT_LINE_FRESH_MS)
            ? ` · updated ${formatRelativeAge(lastUpdated, nowMs)}`
            : "";

    return (
        <div className={FOR_YOU_HOME_FRAME_CLASS} data-testid="for-you-home">
            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
                {showToggle && <ForYouToggle value={homeView} onChange={onHomeViewChange} />}
            </div>

            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2" data-testid="for-you-preferences">
                {prefsChips.map((chip) => (
                    <span key={chip.key} className={cn(chipVariants({ active: true }), toolbarChipClass)}>
                        {chip.label}
                    </span>
                ))}
                <Link
                    href="/settings"
                    className={cn(
                        chipVariants({ interactive: true }),
                        toolbarChipClass,
                        "text-muted-foreground",
                    )}
                >
                    Edit preferences
                </Link>
            </div>

            {showLoading ? (
                <ForYouLoadingSkeleton />
            ) : visiblePacks.length === 0 ? (
                <div
                    data-testid="for-you-empty"
                    className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-panel bg-card p-12 text-center"
                >
                    <p className="text-sm text-muted-foreground">
                        No ranked roles to show right now. Try Search to browse the full list.
                    </p>
                    {showToggle && (
                        <Button type="button" variant="default" onClick={() => onHomeViewChange("search")}>
                            Go to Search
                        </Button>
                    )}
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-[minmax(0,37%)_minmax(0,63%)] xl:gap-4">
                    <div
                        data-testid="detail-pane"
                        className="hidden xl:order-2 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden xl:sticky xl:top-[var(--jobs-sticky-offset)] xl:max-h-[calc(100dvh-var(--jobs-sticky-offset)-var(--jobs-sticky-gap))] xl:min-w-0 xl:rounded-panel xl:border xl:border-border xl:bg-card"
                    >
                        {detailJob ? (
                            renderDetail(undefined)
                        ) : (
                            <p className="p-6 text-xs text-muted-foreground" data-testid="detail-pane-placeholder">
                                Select a role to read it here.
                            </p>
                        )}
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-card xl:min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-3 px-[var(--list-inset)] py-2 text-sm text-muted-foreground">
                            <span
                                data-testid="for-you-result-line"
                                className="font-semibold text-foreground tabular-nums"
                            >
                                {visiblePacks.length} ranked · By fit{freshnessSuffix}
                            </span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Ranked roles">
                            {visiblePacks.map((job, index) => (
                                <JobCard
                                    key={job.id}
                                    job={job}
                                    active={activeJob?.id === job.id}
                                    opened={false}
                                    onClick={() => selectIndex(index)}
                                    now={nowMs}
                                    matchScore={matchScores?.get(job.id) ?? null}
                                    matchAsOfDate={matchAsOfDate}
                                    pursuit={pursuitsByJobId.get(job.id)}
                                    onGoAfter={() => onGoAfter(job)}
                                    goingAfter={goingAfterId === job.id}
                                    position={index + 1}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <Sheet open={!isXlUp && mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent
                    side="bottom"
                    hideCloseButton
                    className="left-1/2 flex max-h-[min(88dvh,760px)] w-full max-w-[720px] -translate-x-1/2 flex-col overflow-hidden border border-border border-b-0 p-0 data-[state=open]:duration-[var(--transition-panel)] data-[state=closed]:duration-[var(--transition-panel)]"
                >
                    <div className="shrink-0 border-b border-border">
                        <div className="flex justify-center pb-1 pt-2.5" aria-hidden="true">
                            <SheetHandle />
                        </div>
                        <div className="flex items-center gap-2 px-4 pb-3">
                            <div className="min-w-0 flex-1">
                                {detailJob ? (
                                    <>
                                        <p className="truncate text-base font-semibold text-foreground">
                                            {decodeText(detailJob.title)}
                                        </p>
                                        <p className="truncate text-meta text-muted-foreground">
                                            {displayCompanyBrand(detailJob.company, detailJob.company_domain, detailJob.title)}
                                        </p>
                                    </>
                                ) : (
                                    <p className="truncate text-base font-semibold text-foreground">Job details</p>
                                )}
                            </div>
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={() => setMobileOpen(false)}
                                className="flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none text-faint transition-opacity hover:opacity-80"
                            >
                                ×
                            </button>
                        </div>
                    </div>
                    <SheetTitle className="sr-only">
                        {detailJob
                            ? `${decodeText(detailJob.title)} at ${displayCompanyBrand(detailJob.company, detailJob.company_domain, detailJob.title)}`
                            : "Job details"}
                    </SheetTitle>
                    <div
                        data-testid="mobile-detail-scroller"
                        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom,0px)] custom-scrollbar"
                    >
                        {/* `undefined`: the sheet chrome above already renders its own
                            × — see the identical rationale at jobs/page.tsx's mobile
                            Sheet. `collapseDescription={false}`: this Sheet IS the
                            scroller. */}
                        {renderDetail(undefined, false)}
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}

/** Neutral first-paint column while résumé presence is still unknown. Same
 *  frame as For you — never Search chrome. Same skeleton shape as the
 *  loading state so the visitor never sees a different "card shape" appear
 *  mid-load. */
export function ForYouHomePending() {
    return (
        <div className={FOR_YOU_HOME_FRAME_CLASS} data-testid="for-you-home-pending">
            <ForYouLoadingSkeleton />
        </div>
    );
}
