"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, CircleNotch, UploadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { formatDeckShowingLine } from "@/lib/pursuits/daily-apply-plan";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
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

/** For-you frame grows with the pack deck — document scroll, not a nested
 *  100dvh trap. JD scroll stays inside each postcard (`data-pack-scroll`). */
export const FOR_YOU_HOME_FRAME_CLASS = "flex flex-col";

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
}

/** Placeholder shape for both the loading state and the pre-résumé shell —
 *  one skeleton, reused, so the two never drift into different "card
 *  shapes." Only `<div>`s: no headings or interactive elements, since the
 *  pre-résumé shell must stay free of both (first-paint spec rule). */
function ForYouPackSkeleton() {
    return (
        <div className="flex flex-col overflow-hidden rounded-panel border border-border bg-card">
            <div className="border-b border-border bg-muted py-4 px-4 lg:py-6 lg:px-8">
                <div className="flex items-start gap-3">
                    <Skeleton className="size-10 shrink-0" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-3 w-40" />
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Skeleton className="h-7 w-20" />
                    <Skeleton className="h-7 w-24" />
                    <Skeleton className="h-7 w-16" />
                </div>
            </div>
            <div className="grid gap-6 py-4 px-4 lg:grid-cols-[280px_1fr] lg:py-6 lg:px-8">
                <div className="hidden border border-border bg-muted p-4 lg:block">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="mt-3 h-2 w-full" />
                    <Skeleton className="mt-4 h-3 w-24" />
                    <Skeleton className="mt-2 h-2 w-full" />
                </div>
                <div className="max-h-[min(60dvh,640px)] space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                </div>
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
    resume,
    nowMs,
    fitResolving,
    loading,
    fitActive,
    hydratedJobs,
    onActivePackChange,
    onOpenPosting,
    onHomeViewChange,
    showSearchCta,
    onReplaceResume,
    hasUsableResume = false,
    onLoadMore,
    loadingMore = false,
    hasMore = false,
    resultTotal = null,
}: ForYouHomeProps) {
    const draftCache = useRef<Map<string, TailorDraft>>(new Map());
    const [applying, setApplying] = useState(false);
    const [hintDismissed, setHintDismissed] = useState(true);

    useEffect(() => {
        setHintDismissed(readForYouHintDismissed());
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

    const showLoading = fitResolving || loading || !fitActive;
    const canNavigate = !showLoading && visiblePacks.length > 0;

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
        <div className={FOR_YOU_HOME_FRAME_CLASS} data-testid="for-you-home">
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
                                <Kbd>←</Kbd>
                                <Kbd>K</Kbd>
                                <span className="text-xs" aria-hidden>/</span>
                                <Kbd>J</Kbd>
                                <Kbd>→</Kbd>
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
                            <Kbd className="align-middle">←</Kbd> <Kbd className="align-middle">→</Kbd>) to move
                            between matches. Skip removes a role from this list.
                        </p>
                        <button type="button" onClick={dismissHint} className={cn(TEXT_LINK_BUTTON_CLASS, "text-brand")}>
                            Got it
                        </button>
                    </AlertDescription>
                </Alert>
            )}

            {showLoading ? (
                <div data-testid="for-you-loading">
                    <ForYouPackSkeleton />
                </div>
            ) : visiblePacks.length === 0 ? (
                <div
                    data-testid="for-you-empty"
                    className="flex flex-col items-center justify-center gap-4 rounded-panel border border-border bg-card p-12 text-center"
                >
                    <p className="text-sm text-muted-foreground">
                        No ranked roles to show right now. Try Search to browse the full list.
                    </p>
                    {showSearchCta && (
                        <Button type="button" variant="outline" onClick={() => onHomeViewChange("search")}>
                            Go to Search
                        </Button>
                    )}
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
                    <div className="flex gap-2">
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
                    </div>
                </div>
            )}
        </div>
    );
}

/** Neutral first-paint column while résumé presence is still unknown.
 *  Same frame as For you — never Search chrome. Same skeleton shape as the
 *  loading state (`ForYouPackSkeleton`) so the visitor never sees a
 *  different "card shape" appear mid-load. */
export function ForYouHomePending() {
    return (
        <div className={FOR_YOU_HOME_FRAME_CLASS} data-testid="for-you-home-pending">
            <ForYouPackSkeleton />
        </div>
    );
}
