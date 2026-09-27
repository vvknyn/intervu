"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, CircleNotch, UploadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { formatDeckShowingLine } from "@/lib/pursuits/daily-apply-plan";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
    JOBS_SESSION_FRAME_CLASS,
    ForYouDeckSkeleton,
    JobsSessionLoadingShell,
} from "@/components/layout/jobs-session-loading";
import { ConceptAEmptyState } from "@/components/ui/concept-a-empty-state";
import { readPacksProofLoading } from "@/lib/jobs/for-you/packs-proof-loading";
import { Kbd } from "@/components/ui/kbd";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ForYouDeck } from "@/components/jobs/for-you/ForYouDeck";
import { hasMeaningfulDiff } from "@/lib/jobs/for-you/tailor-diff";
import { jobToTailorInput, tailorResumeForJob } from "@/lib/local-ai/tailor-with-engine";
import type { TailorDraft } from "@/lib/local-ai/tailor-resume";
import { exportZipResumePdfFromData } from "@/lib/resume/export-zip-pdf";
import { deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import { resolveDeckShortcut } from "@/lib/jobs/for-you/deck-keyboard";
import { readForYouHintDismissed, writeForYouHintDismissed } from "@/lib/jobs/for-you/first-run-hint";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { toast } from "@/lib/toast";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";
import { cn } from "@/lib/utils";
import {
    FOR_YOU_DOWNLOAD_LABEL,
    FOR_YOU_UPLOAD_PDF_EMPTY,
} from "@/lib/jobs/resume-cta-copy";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { locationText } from "@/lib/jobs/presentation";
import type { Pursuit } from "@/lib/pursuits/types";

export { JOBS_SESSION_FRAME_CLASS, JOBS_SESSION_FRAME_CLASS as FOR_YOU_HOME_FRAME_CLASS };

/** For-you frame grows with the pack deck — document scroll, not a nested
 *  100dvh trap. JD scroll stays inside each postcard (`data-pack-scroll`). */

/** Recurring quiet text-link button shape (Replace / Upload résumé / Got
 *  it) — one class, not three copies that can drift apart. */
const TEXT_LINK_BUTTON_CLASS =
    "inline-flex min-h-11 items-center text-xs font-semibold text-foreground transition-colors hover:text-brand";

export interface ForYouHomeProps {
    visiblePacks: PublicJob[];
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
    activeJob: PublicJob | null;
    onSkip: () => void;
    matchScores: Map<string, MatchScore | null> | null;
    resume: ResumeData | null;
    nowMs: number;
    fitResolving: boolean;
    loading: boolean;
    fitActive: boolean;
    hydratedJobs: Map<string, { job: PublicJob; descriptionPending: boolean }>;
    onActivePackChange: (jobId: string) => void;
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
    /** Known corpus total for optional "N of ~total · Strong first" near Show more. */
    resultTotal?: number | null;
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

export function ForYouHome({
    visiblePacks,
    activeIndex,
    onActiveIndexChange,
    activeJob,
    onSkip,
    matchScores,
    resume,
    nowMs,
    fitResolving,
    loading,
    fitActive,
    hydratedJobs,
    onActivePackChange,
    onRetryDescription,
    onOpenPosting,
    onHomeViewChange,
    showSearchCta,
    onReplaceResume,
    hasUsableResume = false,
    onLoadMore,
    loadingMore = false,
    hasMore = false,
    resultTotal = null,
    firstRevealEnter = false,
    firstRevealDeckFocus = false,
    onFirstRevealFocusDone,
    activePursuit,
    onGoAfter,
    saveSuccessPulse = false,
}: ForYouHomeProps) {
    const draftCache = useRef<Map<string, TailorDraft>>(new Map());
    const [applying, setApplying] = useState(false);
    const [hintDismissed, setHintDismissed] = useState(true);
    const [proofLoading, setProofLoading] = useState(false);

    useEffect(() => {
        setHintDismissed(readForYouHintDismissed());
        setProofLoading(readPacksProofLoading());
    }, []);

    const dismissHint = useCallback(() => {
        writeForYouHintDismissed();
        setHintDismissed(true);
    }, []);

    const prewarmDraft = useCallback(
        async (job: PublicJob) => {
            if (!resume || draftCache.current.has(job.id)) return;
            const hydrated = hydratedJobs.get(job.id)?.job ?? job;
            try {
                const draft = await tailorResumeForJob(resume, jobToTailorInput(hydrated), {
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
                const hydrated = hydratedJobs.get(activeJob.id)?.job ?? activeJob;
                let draft = draftCache.current.get(activeJob.id);
                if (!draft) {
                    draft = await tailorResumeForJob(resume, jobToTailorInput(hydrated), {
                        allowModel: false,
                    });
                    draftCache.current.set(activeJob.id, draft);
                }
                const pdfData = hasMeaningfulDiff(draft) ? draft.tailored : resume;
                await exportPdfForJob(activeJob, pdfData);
            } catch {
                // toast already shown for PDF failure
            } finally {
                setApplying(false);
            }
        })();
    }, [activeJob, resume, applying, hydratedJobs, exportPdfForJob, onOpenPosting]);

    const showLoading = proofLoading || fitResolving || loading || !fitActive;
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

    const shortcutStateRef = useRef({ activeIndex, packsLength: visiblePacks.length, canNavigate, applying });
    shortcutStateRef.current = { activeIndex, packsLength: visiblePacks.length, canNavigate, applying };

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const { activeIndex, packsLength, canNavigate, applying } = shortcutStateRef.current;
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
            } else if (action === "skip" && !applying) {
                onSkip();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onActiveIndexChange, onSkip]);

    const showingLine = formatDeckShowingLine(visiblePacks.length, resultTotal);

    return (
        <div className={cn(JOBS_SESSION_FRAME_CLASS, "state-opacity-in")} data-testid="for-you-home">
            {(canNavigate || (hasUsableResume && onReplaceResume)) && (
                <div className="mb-4 flex shrink-0 flex-wrap items-center justify-end gap-3 pt-1">
                    {canNavigate && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label="Previous role"
                                data-testid="for-you-previous"
                                className="h-11 w-11"
                                onClick={() => onActiveIndexChange(Math.max(activeIndex - 1, 0))}
                                disabled={activeIndex === 0}
                            >
                                <CaretLeft size={16} weight="bold" aria-hidden />
                            </Button>
                            <div className="flex flex-wrap items-center gap-2">
                                <p
                                    className="text-xs text-muted-foreground tabular-nums"
                                    data-testid="for-you-deck-position"
                                >
                                    {activeIndex + 1} of {visiblePacks.length}
                                </p>
                                <ProgressBar
                                    progress={((activeIndex + 1) / visiblePacks.length) * 100}
                                    className="w-16"
                                />
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label="Next role"
                                data-testid="for-you-next"
                                className="h-11 w-11"
                                onClick={() =>
                                    onActiveIndexChange(Math.min(activeIndex + 1, visiblePacks.length - 1))
                                }
                                disabled={activeIndex === visiblePacks.length - 1}
                            >
                                <CaretRight size={16} weight="bold" aria-hidden />
                            </Button>
                            <span className="hidden items-center gap-1 text-muted-foreground lg:flex">
                                <Kbd>Left</Kbd>
                                <Kbd>K</Kbd>
                                <span className="text-xs" aria-hidden>/</span>
                                <Kbd>J</Kbd>
                                <Kbd>Right</Kbd>
                            </span>
                        </div>
                    )}
                    {hasUsableResume && onReplaceResume && (
                        <button
                            type="button"
                            data-testid="jobs-replace-resume"
                            onClick={onReplaceResume}
                            className={TEXT_LINK_BUTTON_CLASS}
                        >
                            Replace résumé
                        </button>
                    )}
                </div>
            )}

            {canNavigate && !hintDismissed && (
                <Alert className="mb-4 shrink-0">
                    <AlertTitle>Getting around</AlertTitle>
                    <AlertDescription>
                        <p>
                            Scroll the card to read the role. Use Next and Previous (or{" "}
                            <Kbd className="align-middle">Left</Kbd> and <Kbd className="align-middle">Right</Kbd>) to
                            move between matches. Skip removes a role from this list.
                        </p>
                        <button type="button" onClick={dismissHint} className={cn(TEXT_LINK_BUTTON_CLASS, "text-brand")}>
                            Got it
                        </button>
                    </AlertDescription>
                </Alert>
            )}

            {showLoading ? (
                <div data-testid="for-you-loading" className="state-opacity-in">
                    <ForYouDeckSkeleton tone="postcard" withStatus />
                </div>
            ) : visiblePacks.length === 0 ? (
                <div className="flex flex-1 flex-col justify-center" data-testid="for-you-empty-wrap">
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
                </div>
            ) : (
                <ForYouDeck
                    packs={visiblePacks}
                    activeIndex={activeIndex}
                    matchScores={matchScores}
                    resume={resume}
                    nowMs={nowMs}
                    hydratedJobs={hydratedJobs}
                    onActivePackChange={onActivePackChange}
                    onRetryDescription={onRetryDescription}
                    firstReveal={firstRevealEnter}
                    onSwipeNavigate={(direction) => {
                        if (direction === "previous") {
                            onActiveIndexChange(Math.max(activeIndex - 1, 0));
                        } else {
                            onActiveIndexChange(Math.min(activeIndex + 1, visiblePacks.length - 1));
                        }
                    }}
                />
            )}

            {visiblePacks.length > 0 && !showLoading && (showingLine || (hasMore && onLoadMore)) && (
                <div
                    className="mt-4 flex flex-col items-center gap-2"
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
                            size="sm"
                            data-testid="for-you-show-more"
                            onClick={() => void onLoadMore()}
                            disabled={loadingMore}
                            className="text-xs font-semibold"
                        >
                            {loadingMore ? "Loading more…" : "Show more matches"}
                        </Button>
                    ) : null}
                </div>
            )}

            {visiblePacks.length > 0 && !showLoading && activeJob && (
                <div className="mt-3" data-testid="for-you-mcp-handoff">
                    <McpHandoffNote
                        variant="intelligence"
                        job={{
                            id: activeJob.id,
                            title: activeJob.title,
                            company: activeJob.company || "Unknown company",
                            location: locationText(activeJob) || null,
                        }}
                    />
                </div>
            )}

            {visiblePacks.length > 0 && !showLoading && (
                <div className="mt-4 shrink-0 border-t border-border pt-4">
                    {!resume && onReplaceResume && (
                        <div className="mb-3 space-y-2">
                            <p className="text-xs text-muted-foreground">{FOR_YOU_UPLOAD_PDF_EMPTY}</p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="for-you-upload-resume"
                                onClick={onReplaceResume}
                                className="inline-flex items-center gap-1.5 font-normal"
                            >
                                <UploadSimple size={16} weight="bold" aria-hidden />
                                Upload résumé
                            </Button>
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            className="h-11 min-h-11 flex-1 lg:flex-none"
                            data-testid="for-you-download-apply"
                            onClick={handleDownloadApply}
                            disabled={applying || !resume}
                        >
                            {applying ? (
                                <>
                                    <CircleNotch size={16} className="mr-2 animate-spin" aria-hidden />
                                    Preparing…
                                </>
                            ) : (
                                FOR_YOU_DOWNLOAD_LABEL
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-11 min-h-11 flex-1 lg:flex-none"
                            data-testid="for-you-skip"
                            onClick={onSkip}
                            disabled={applying}
                        >
                            Skip
                        </Button>
                        {onGoAfter && activeJob ? (
                            <span data-testid="for-you-deck-save" className="shrink-0">
                                <RowBookmarkButton
                                    pursuit={activePursuit}
                                    onGoAfter={() => onGoAfter(activeJob)}
                                    successPulse={saveSuccessPulse}
                                />
                            </span>
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    );
}

/** Neutral first-paint column while résumé presence is still unknown.
 *  Same frame as For you — never Search chrome. Same skeleton shape as the
 *  loading state (`ForYouDeckSkeleton`) so the visitor never sees a
 *  different "card shape" appear mid-load. */
export function ForYouHomePending() {
    return (
        <div className={cn(JOBS_SESSION_FRAME_CLASS, "state-opacity-in")} data-testid="for-you-home-pending">
            <JobsSessionLoadingShell />
        </div>
    );
}
