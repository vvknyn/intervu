"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BookmarkSimple, UploadSimple } from "@phosphor-icons/react";
import { InlineSpinner, WaitBar, WaitState } from "@/components/ui/wait-state";
import { Button } from "@/components/ui/button";
import { formatDeckShowingLine } from "@/lib/pursuits/daily-apply-plan";
import {
    JOBS_SESSION_FRAME_CLASS,
    JobsSessionLoadingShell,
} from "@/components/layout/jobs-session-loading";
import { ConceptAEmptyPageSlot, ConceptAEmptyState } from "@/components/ui/concept-a-empty-state";
import { LoadFailedState } from "@/components/ui/load-failed-state";
import { readPacksProofLoading } from "@/lib/jobs/for-you/packs-proof-loading";
import { searchJobsAction } from "@/actions/jobs";
import { BroadenOptions } from "@/components/jobs/BroadenOptions";
import { countResults, isThinResults, locationDropped, namedPlaces } from "@/lib/jobs/broaden";
import type { CandidateSignals } from "@/lib/jobs/candidate-signals";
import { packFilters } from "@/lib/jobs/for-you/pack-filters";
import type { HubPackId } from "@/lib/jobs/for-you/hub-pack-filters";
import { hubTile } from "@/lib/jobs/for-you/hub-tiles";
import { jobsBoardHref, serializeJobsUrl } from "@/lib/jobs/url-state";
import { LocalCustomizePanel } from "@/components/jobs/LocalCustomizePanel";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { RoleStack } from "@/components/jobs/for-you/RoleStack";
import { StackedRoleCard } from "@/components/jobs/for-you/StackedRoleCard";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { hasMeaningfulDiff } from "@/lib/jobs/for-you/tailor-diff";
import { resumeForPackApply } from "@/lib/jobs/for-you/pack-apply-location";
import { jobToTailorInput, tailorResumeForJob } from "@/lib/local-ai/tailor-with-engine";
import type { TailorDraft } from "@/lib/local-ai/tailor-resume";
import { exportZipResumePdfFromData } from "@/lib/resume/export-zip-pdf";
import { deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import { deckListLoading } from "@/lib/jobs/for-you/deck-list-loading";
import { resolveDeckShortcut } from "@/lib/jobs/for-you/deck-keyboard";
import { resolveDescriptionHydration } from "@/lib/jobs/for-you/description-pane-state";
import { prefetchIndexesAhead } from "@/lib/jobs/for-you/deck-active-job";
import { clampDeckIndex } from "@/lib/jobs/for-you/deck-index";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { jobActionIconSize } from "@/lib/jobs/toolbar-control-height";
import { toast } from "@/lib/toast";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";
import { MOTION_DURATION_MS } from "@/lib/motion/interaction-contract";
import { displayCompanyBrand } from "@/lib/jobs/presentation";
import { cn } from "@/lib/utils";
import {
    FOR_YOU_DOWNLOAD_LABEL,
    FOR_YOU_UPLOAD_PDF_EMPTY,
} from "@/lib/jobs/resume-cta-copy";
import type { Pursuit } from "@/lib/pursuits/types";

export { JOBS_SESSION_FRAME_CLASS, JOBS_SESSION_FRAME_CLASS as FOR_YOU_HOME_FRAME_CLASS };

/** An opened pack is a stack of role cards (RoleStack): one role at a time,
 *  moved through with Previous / Next / Skip, arrow keys or a swipe. The
 *  stack fills the locked pane, and each card scrolls inside itself. */

const REPLACE_RESUME_CLASS =
    "text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground";

export interface ForYouHomeProps {
    visiblePacks: PublicJob[];
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
    activeJob: PublicJob | null;
    onSkip: () => void;
    matchScores: Map<string, MatchScore | null> | null;
    resume: ResumeData | null;
    /** Résumé + saved preferences, resolved once by the page (`resolveCandidateSignals`). */
    signals: CandidateSignals | null;
    nowMs: number;
    /** The ranked list's read failed (after its automatic retry). With no
     *  rows, this renders `LoadFailedState` instead of the empty state. */
    loadError: string | null;
    onRetryLoad: () => void;
    fitResolving: boolean;
    loading: boolean;
    fitActive: boolean;
    hydratedJobs: Map<string, { job: PublicJob; descriptionPending: boolean }>;
    onActivePackChange: (jobId: string) => void;
    /** A role the visitor deliberately stepped to (Next, Previous, an arrow
     *  key or a swipe), not the first card or the one Skip brings forward —
     *  the page records it as a view. */
    onOpenRow?: (job: PublicJob) => void;
    onRetryDescription?: (jobId: string) => void;
    onOpenPosting: (job: PublicJob) => void;
    onHomeViewChange: (view: JobsHomeView) => void;
    showSearchCta: boolean;
    onReplaceResume?: () => void;
    hasUsableResume?: boolean;
    /** Load next PAGE chunk into the deck (same loadMore as SERP). */
    onLoadMore?: () => void;
    loadingMore?: boolean;
    hasMore?: boolean;
    /** The page's fit gate, shown where the list stops for a guest (replaces "Show more"). */
    signupGate?: ReactNode;
    /** Known corpus total for optional "N of ~total · Strong first" near Show more. */
    resultTotal?: number | null;
    /** Location text the list's search could not filter on (`unmatchedPlaceMentions`).
     *  When it covers every place the pack names, the list is not the pack. */
    unmatchedPlaces?: string[];
    /** The hub tile this list was opened from: a filter tile's own filter is part of the pack (hub-tiles.ts). */
    tileId?: HubPackId;
    /** CRAFT-3 — enter-reveal on first pack after auto-reveal. */
    firstRevealEnter?: boolean;
    /** CRAFT-3 — focus deck primary CTA once after first-pack auto-reveal. */
    firstRevealDeckFocus?: boolean;
    onFirstRevealFocusDone?: () => void;
    /** Active pack save — same RowBookmarkButton / optimistic overlay contract as SERP rows. */
    activePursuit?: Pursuit;
    onGoAfter?: (job: PublicJob) => void;
    saveSuccessPulse?: boolean;
}

/** "Iceland", "Iceland and Norway", "Iceland, Norway and Denmark". */
function formatPlaceList(places: string[]): string {
    return places.length < 2 ? (places[0] ?? "") : `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}`;
}

function RoleCardSkeleton() {
    return (
        <div className="flex flex-col gap-4 rounded-panel border border-border bg-card p-6" aria-hidden>
            <div className="flex items-center gap-3">
                <WaitBar className="size-10 shrink-0" />
                <WaitBar className="h-4 w-1/3" />
            </div>
            <WaitBar className="h-7 w-2/3" />
            <WaitBar className="h-4 w-1/2" />
            <div className="space-y-2 pt-2">
                <WaitBar className="h-3 w-full" />
                <WaitBar className="h-3 w-5/6" />
                <WaitBar className="h-3 w-4/6" />
            </div>
        </div>
    );
}

/** Nothing to list: a stable empty deck. */
const NO_PACKS: PublicJob[] = [];

export function ForYouHome({
    visiblePacks: listedPacks,
    activeIndex,
    onActiveIndexChange,
    activeJob,
    onSkip,
    matchScores,
    resume,
    signals,
    nowMs,
    fitResolving,
    loading,
    loadError,
    onRetryLoad,
    hydratedJobs,
    onActivePackChange,
    onOpenRow,
    onRetryDescription,
    onOpenPosting,
    onHomeViewChange,
    showSearchCta,
    onReplaceResume,
    hasUsableResume = false,
    onLoadMore,
    loadingMore = false,
    hasMore = false,
    signupGate = null,
    resultTotal = null,
    firstRevealEnter = false,
    firstRevealDeckFocus = false,
    onFirstRevealFocusDone,
    activePursuit,
    onGoAfter,
    saveSuccessPulse = false,
    unmatchedPlaces,
    tileId,
}: ForYouHomeProps) {
    // The pack is a `/jobs` filter state: "Edit filters" opens /jobs on exactly it.
    const filters = useMemo(
        () => (resume && signals ? hubTile(packFilters(resume, signals), tileId ?? "all").state : null),
        [resume, signals, tileId],
    );
    // The list's search dropped every place the pack names, so its rows come from
    // anywhere. The pack's location is where the candidate can work: none of them fit.
    const placesMissing = filters != null && locationDropped(filters, { unmatchedPlaceMentions: unmatchedPlaces });
    const visiblePacks = placesMissing ? NO_PACKS : listedPacks;
    // The list's own search kept the place and found nothing there: the corpus has roles in it,
    // none of them this pack's. Name the place, not the generic "right now" empty state.
    const placeEmpty =
        filters != null && !placesMissing && !loadError && resultTotal === 0 && visiblePacks.length === 0;
    const places = filters ? namedPlaces(filters) : [];
    const noRolesThereTitle =
        places.length === 0
            ? null
            : placesMissing
              ? `No roles in ${formatPlaceList(places)} yet.`
              : placeEmpty
                ? `No matching roles in ${formatPlaceList(places)} yet.`
                : null;
    const draftCache = useRef<Map<string, TailorDraft>>(new Map());
    const [applying, setApplying] = useState(false);
    const [proofLoading, setProofLoading] = useState(false);
    // A role Skip just removed: it stays on the stack one more beat to tip
    // back and fade (RoleStack), then goes.
    const [departing, setDeparting] = useState<PublicJob | null>(null);

    useEffect(() => {
        setProofLoading(readPacksProofLoading());
    }, []);

    const prewarmDraft = useCallback(
        async (job: PublicJob) => {
            if (!resume || draftCache.current.has(job.id)) return;
            const hydrated = hydratedJobs.get(job.id)?.job ?? job;
            const located = resumeForPackApply(resume);
            try {
                const draft = await tailorResumeForJob(located, jobToTailorInput(hydrated), {
                    allowModel: false,
                });
                draftCache.current.set(job.id, draft);
            } catch {
                // Best-effort pre-warm — apply path generates on demand.
            }
        },
        [resume, hydratedJobs],
    );

    useEffect(() => {
        if (activeJob) void prewarmDraft(activeJob);
        const next = visiblePacks[activeIndex + 1];
        if (next) void prewarmDraft(next);
    }, [activeJob, activeIndex, visiblePacks, prewarmDraft]);

    useEffect(() => {
        const job = visiblePacks[activeIndex];
        if (job) onActivePackChange(job.id);
        for (const index of prefetchIndexesAhead(activeIndex, visiblePacks.length, 3)) {
            onActivePackChange(visiblePacks[index].id);
        }
    }, [activeIndex, visiblePacks, onActivePackChange]);

    const exportPdfForJob = useCallback(
        async (job: PublicJob, data: ResumeData) => {
            const filename = deriveResumePdfFilename({
                company: job.company ?? null,
                role: job.title ?? data.profile.profession ?? null,
                fallbackLabel: data.profile.name || "resume",
                dateIso: new Date().toISOString(),
            });
            try {
                await exportZipResumePdfFromData(data, `${filename}.pdf`);
            } catch {
                toast.error("Failed to generate PDF");
                throw new Error("pdf failed");
            }
        },
        [],
    );

    const handleDownloadApply = useCallback(() => {
        if (!activeJob || !resume || applying) return;
        onOpenPosting(activeJob);
        setApplying(true);
        void (async () => {
            try {
                const located = resumeForPackApply(resume);
                const hydrated = hydratedJobs.get(activeJob.id)?.job ?? activeJob;
                let draft = draftCache.current.get(activeJob.id);
                if (!draft) {
                    draft = await tailorResumeForJob(located, jobToTailorInput(hydrated), {
                        allowModel: false,
                    });
                    draftCache.current.set(activeJob.id, draft);
                }
                const tailored = hasMeaningfulDiff(draft) ? draft.tailored : located;
                await exportPdfForJob(activeJob, resumeForPackApply(tailored));
            } catch {
                // toast already shown for PDF failure
            } finally {
                setApplying(false);
            }
        })();
    }, [activeJob, resume, applying, hydratedJobs, exportPdfForJob, onOpenPosting]);

    // Rows render without a résumé. fitActive stays on the props type for
    // callers; it must not keep a non-empty pack on the ranking shell.
    const showLoading = deckListLoading({
        proofLoading,
        fitResolving,
        loading,
        packCount: visiblePacks.length,
    });
    const canNavigate = !showLoading && visiblePacks.length > 0;

    useEffect(() => {
        if (!firstRevealDeckFocus || showLoading || visiblePacks.length === 0) return;
        const id = window.requestAnimationFrame(() => {
            const el = document.querySelector<HTMLElement>('[data-testid="for-you-download-apply"]');
            el?.focus({ preventScroll: true });
            onFirstRevealFocusDone?.();
        });
        return () => window.cancelAnimationFrame(id);
    }, [firstRevealDeckFocus, showLoading, visiblePacks.length, onFirstRevealFocusDone]);

    const selectedIndex =
        activeIndex >= 0 && activeIndex < visiblePacks.length ? activeIndex : 0;
    const selectedJob = visiblePacks[selectedIndex] ?? activeJob;

    // Next, Previous, the arrow keys and a swipe all land here: a role the
    // visitor stepped to counts as viewed. The first card and the one Skip
    // brings forward arrive on their own and are not recorded.
    const goTo = useCallback(
        (index: number) => {
            const next = clampDeckIndex(index, visiblePacks.length);
            if (next === selectedIndex) return;
            onActiveIndexChange(next);
            const job = visiblePacks[next];
            if (job) onOpenRow?.(job);
        },
        [visiblePacks, selectedIndex, onActiveIndexChange, onOpenRow],
    );

    // Skip removes the open role from the list. Keep it on the stack long
    // enough to tip back under the role that replaces it (RoleStack).
    const skipActive = useCallback(() => {
        const job = visiblePacks[clampDeckIndex(activeIndex, visiblePacks.length)];
        if (job) setDeparting(job);
        onSkip();
    }, [visiblePacks, activeIndex, onSkip]);

    useEffect(() => {
        if (!departing) return;
        const id = window.setTimeout(() => setDeparting(null), MOTION_DURATION_MS.stack + 100);
        return () => window.clearTimeout(id);
    }, [departing]);

    const shortcutStateRef = useRef({ selectedIndex, canNavigate, applying, goTo, skipActive });
    shortcutStateRef.current = { selectedIndex, canNavigate, applying, goTo, skipActive };

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const { selectedIndex, canNavigate, applying, goTo, skipActive } = shortcutStateRef.current;
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
                goTo(selectedIndex - 1);
            } else if (action === "next") {
                goTo(selectedIndex + 1);
            } else if (action === "skip" && !applying) {
                skipActive();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    const showingLine = formatDeckShowingLine(visiblePacks.length, resultTotal);
    // The pack's own count: what applying these filters returns, not the size of the deck on screen.
    // The pack's location is where the candidate can work, so a search that dropped it counts 0.
    const [packTotal, setPackTotal] = useState<number | null>(null);
    const packKey = filters ? serializeJobsUrl(filters) : null;
    useEffect(() => {
        if (!filters) return;
        let live = true;
        setPackTotal(null);
        void countResults(filters, searchJobsAction, { locationRequired: true }).then((total) => {
            if (live) setPackTotal(total);
        });
        return () => {
            live = false;
        };
        // `packKey` is the identity of `filters`; `searchJobsAction` is a stable action.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [packKey]);
    useEffect(() => {
        if (visiblePacks.length === 0) return;
        if (activeIndex < 0 || activeIndex >= visiblePacks.length) onActiveIndexChange(0);
    }, [activeIndex, visiblePacks.length, onActiveIndexChange]);

    const lastIndex = visiblePacks.length - 1;
    const atEnd = selectedIndex >= lastIndex;
    const upNext = atEnd ? null : visiblePacks[selectedIndex + 1];

    const renderCard = (job: PublicJob, active: boolean) => {
        const hydration = resolveDescriptionHydration(job, hydratedJobs.get(job.id));
        return (
            <StackedRoleCard
                job={hydration.job}
                active={active}
                nowMs={nowMs}
                matchScore={matchScores?.get(job.id) ?? null}
                resume={resume}
                descriptionPending={hydration.descriptionPending}
                onRetryDescription={onRetryDescription ? () => onRetryDescription(job.id) : undefined}
                onOpenPosting={() => onOpenPosting(hydration.job)}
                actions={cardActions(hydration.job, active)}
            />
        );
    };

    // Every card carries the same actions so a card sliding in never changes
    // height. Only the open role's are wired and carry test ids; the rest are
    // look-alikes on inert cards (RoleStack). Their Save shows unsaved because
    // the page only knows the open role's pursuit.
    const cardActions = (job: PublicJob, active: boolean) => (
        <div className="flex flex-col gap-2">
            {!resume && onReplaceResume ? (
                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">{FOR_YOU_UPLOAD_PDF_EMPTY}</p>
                    <Button
                        type="button"
                        variant="outline"
                        data-testid={active ? "for-you-upload-resume" : undefined}
                        onClick={onReplaceResume}
                        className="inline-flex items-center gap-1.5"
                    >
                        <UploadSimple size={16} weight="bold" aria-hidden />
                        Upload résumé
                    </Button>
                </div>
            ) : null}
            <Button
                type="button"
                className="w-full"
                data-testid={active ? "for-you-download-apply" : undefined}
                onClick={active ? handleDownloadApply : undefined}
                disabled={applying || !resume}
            >
                {applying && active ? (
                    <>
                        <InlineSpinner size={16} className="mr-2" />
                        Preparing…
                    </>
                ) : (
                    FOR_YOU_DOWNLOAD_LABEL
                )}
            </Button>
            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    data-testid={active ? "for-you-skip" : undefined}
                    onClick={active ? skipActive : undefined}
                    disabled={applying}
                >
                    Skip
                </Button>
                {resume ? (
                    active ? (
                        <LocalCustomizePanel job={job} resume={resume} compactTrigger signedIn />
                    ) : (
                        <Button type="button" variant="outline" className="shrink-0 px-3" tabIndex={-1}>
                            Customize résumé
                        </Button>
                    )
                ) : null}
                {active ? (
                    <span data-testid="for-you-deck-save" className="shrink-0">
                        <RowBookmarkButton
                            pursuit={activePursuit}
                            onGoAfter={() => onGoAfter?.(job)}
                            successPulse={saveSuccessPulse}
                            className="rounded-ctl border border-border bg-surface"
                        />
                    </span>
                ) : (
                    <Button
                        type="button"
                        variant="ghost"
                        size={jobActionIconSize}
                        tabIndex={-1}
                        aria-label="Save this job"
                        className="shrink-0 border border-border bg-surface text-muted-foreground"
                    >
                        <BookmarkSimple size={20} />
                    </Button>
                )}
            </div>
        </div>
    );

    return (
        <div
            className={cn(
                JOBS_SESSION_FRAME_CLASS,
                "state-opacity-in h-auto min-h-0 flex-1 overflow-hidden",
            )}
            data-testid="for-you-home"
        >
            {hasUsableResume && onReplaceResume ? (
                <div className="mb-3 flex justify-end">
                    <button
                        type="button"
                        data-testid="jobs-replace-resume"
                        onClick={onReplaceResume}
                        className={REPLACE_RESUME_CLASS}
                    >
                        Replace résumé
                    </button>
                </div>
            ) : null}

            {filters && !showLoading ? (
                <div className="mb-3 shrink-0 space-y-3" data-testid="for-you-pack-filters">
                    <Link
                        href={jobsBoardHref(filters)}
                        data-testid="pack-edit-filters"
                        className={REPLACE_RESUME_CLASS}
                    >
                        Edit filters
                    </Link>
                    {packTotal != null && isThinResults(packTotal) ? (
                        <>
                            {packTotal > 0 ? (
                                <p className="text-xs text-muted-foreground" data-testid="for-you-thin-note">
                                    Only {packTotal} {packTotal === 1 ? "role matches" : "roles match"} your filters.
                                </p>
                            ) : null}
                            <BroadenOptions
                                state={filters}
                                total={packTotal}
                                ctx={{ relocation: signals?.relocation.value, locationRequired: true }}
                                search={searchJobsAction}
                            />
                        </>
                    ) : null}
                </div>
            ) : null}

            {showLoading ? (
                <WaitState
                    data-testid="for-you-loading"
                    className="state-opacity-in"
                    label="Loading your ranked roles"
                    skeleton={<RoleCardSkeleton />}
                />
            ) : noRolesThereTitle ? (
                <ConceptAEmptyPageSlot placement="page" className="flex-1" data-testid="for-you-no-roles-there-wrap">
                    <ConceptAEmptyState
                        testId="for-you-no-roles-there"
                        title={noRolesThereTitle}
                        description="Edit filters or broaden the search to see roles elsewhere."
                    />
                </ConceptAEmptyPageSlot>
            ) : visiblePacks.length === 0 && loadError ? (
                <LoadFailedState
                    title="We can't load your matches right now."
                    detail={loadError}
                    onRetry={onRetryLoad}
                    testId="for-you-load-failed"
                />
            ) : visiblePacks.length === 0 ? (
                <ConceptAEmptyPageSlot placement="page" className="flex-1" data-testid="for-you-empty-wrap">
                    <ConceptAEmptyState
                        testId="for-you-empty"
                        title="No ranked roles to show right now."
                        description="Try Search to browse the full list—we'll keep your place here."
                        actions={
                            showSearchCta ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="for-you-empty-search-cta"
                                    onClick={() => onHomeViewChange("search")}
                                >
                                    Go to Search
                                </Button>
                            ) : undefined
                        }
                    />
                </ConceptAEmptyPageSlot>
            ) : (
                <>
                {selectedJob ? (
                    <McpHandoffNote
                        className="mb-3 shrink-0"
                        job={{
                            id: selectedJob.id,
                            title: selectedJob.title ?? "",
                            company: selectedJob.company ?? "",
                            location: selectedJob.location,
                        }}
                    />
                ) : null}
                <div
                    data-testid="role-stack-controls"
                    className="flex shrink-0 items-center justify-between gap-3"
                >
                    <div className="min-w-0">
                        <p data-testid="for-you-deck-position" className="text-sm font-semibold text-foreground" aria-live="polite">
                            Role {selectedIndex + 1} of {visiblePacks.length}
                        </p>
                        <p className="hidden truncate text-xs text-muted-foreground sm:block">
                            {upNext
                                ? `Up next: ${upNext.title ?? "Untitled role"}${
                                      displayCompanyBrand(upNext.company, upNext.company_domain, upNext.title)
                                          ? `, ${displayCompanyBrand(upNext.company, upNext.company_domain, upNext.title)}`
                                          : ""
                                  }`
                                : "That's the last role here."}
                        </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            data-testid="for-you-previous"
                            onClick={() => goTo(selectedIndex - 1)}
                            disabled={selectedIndex === 0}
                        >
                            Previous
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            data-testid="for-you-next"
                            onClick={() => goTo(selectedIndex + 1)}
                            disabled={atEnd}
                        >
                            Next
                        </Button>
                    </div>
                </div>
                <div
                    data-testid="for-you-deck"
                    className={cn("flex min-h-0 flex-1 flex-col", firstRevealEnter && "state-opacity-in")}
                >
                    <RoleStack
                        className="min-h-0 flex-1"
                        roles={visiblePacks}
                        activeIndex={selectedIndex}
                        departing={departing}
                        renderCard={renderCard}
                        onSwipe={(direction) => goTo(selectedIndex + (direction === "next" ? 1 : -1))}
                    />
                    {signupGate}
                    {!signupGate && atEnd && (showingLine || (hasMore && onLoadMore)) ? (
                        <div
                            className="flex shrink-0 flex-col items-center gap-2 pb-2"
                            data-testid="for-you-show-more-wrap"
                        >
                            {showingLine ? (
                                <p
                                    className="text-xs text-muted-foreground"
                                    data-testid="for-you-showing-total"
                                >
                                    {showingLine}
                                </p>
                            ) : null}
                            {hasMore && onLoadMore ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="for-you-show-more"
                                    onClick={() => void onLoadMore()}
                                    disabled={loadingMore}
                                >
                                    {loadingMore ? "Loading more…" : "Show more matches"}
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                </>
            )}
        </div>
    );
}

/** Neutral first-paint column while résumé presence is still unknown.
 *  Same frame as For you — never Search chrome. */
export function ForYouHomePending() {
    return (
        <div className={cn(JOBS_SESSION_FRAME_CLASS, "state-opacity-in")} data-testid="for-you-home-pending">
            <JobsSessionLoadingShell />
        </div>
    );
}
