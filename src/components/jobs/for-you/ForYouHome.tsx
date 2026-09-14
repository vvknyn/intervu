"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { PreferenceChipStrip } from "@/components/jobs/for-you/PreferenceChipStrip";
import { ForYouDeck } from "@/components/jobs/for-you/ForYouDeck";
import { ForYouToggle } from "@/components/jobs/for-you/ForYouToggle";
import { fetchAgentPreferencesAction } from "@/actions/agent-preferences";
import { buildPreferenceChips } from "@/lib/jobs/for-you/preference-chips";
import { hasMeaningfulDiff } from "@/lib/jobs/for-you/tailor-diff";
import { jobToTailorInput, tailorResumeForJob } from "@/lib/local-ai/tailor-with-engine";
import type { TailorDraft } from "@/lib/local-ai/tailor-resume";
import { exportZipResumePdfFromData } from "@/lib/resume/export-zip-pdf";
import { deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { toast } from "@/lib/toast";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";

/** Fills the jobs-page viewport shell. Overflow stays on inner panes
 *  (deck-wheel + JD `data-pack-scroll`), not a second 100dvh calc that
 *  overflows the already-below-the-topbar page and traps scrolling. */
export const FOR_YOU_HOME_FRAME_CLASS =
    "flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none";

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
    onOpenApply: (job: PublicJob) => void;
    homeView: JobsHomeView;
    onHomeViewChange: (view: JobsHomeView) => void;
    showToggle: boolean;
    onReplaceResume?: () => void;
    hasUsableResume?: boolean;
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
    onOpenApply,
    homeView,
    onHomeViewChange,
    showToggle,
    onReplaceResume,
    hasUsableResume = false,
}: ForYouHomeProps) {
    const [prefsChips, setPrefsChips] = useState(() =>
        buildPreferenceChips({ search: {}, resume, fitFacets: {} }),
    );
    const draftCache = useRef<Map<string, TailorDraft>>(new Map());
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        void (async () => {
            const res = await fetchAgentPreferencesAction();
            const search = res.data?.search ?? {};
            setPrefsChips(buildPreferenceChips({ search, resume, fitFacets: {} }));
        })();
    }, [resume]);

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
        onOpenApply(activeJob);
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
    }, [activeJob, resume, applying, hydratedJobs, exportPdfForJob, onOpenApply]);

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                onActiveIndexChange(Math.min(activeIndex + 1, visiblePacks.length - 1));
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                onActiveIndexChange(Math.max(activeIndex - 1, 0));
            }
        },
        [activeIndex, visiblePacks.length, onActiveIndexChange],
    );

    const showLoading = fitResolving || loading || !fitActive;

    return (
        <div
            className={FOR_YOU_HOME_FRAME_CLASS}
            data-testid="for-you-home"
            onKeyDown={handleKeyDown}
            tabIndex={0}
        >
            <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
                {showToggle && (
                    <ForYouToggle value={homeView} onChange={onHomeViewChange} />
                )}
                {(!showLoading && visiblePacks.length > 0) || (hasUsableResume && onReplaceResume) ? (
                    <div className="flex items-center gap-3">
                        {!showLoading && visiblePacks.length > 0 && (
                            <p className="text-xs text-muted-foreground tabular-nums">
                                {activeIndex + 1} of {visiblePacks.length}
                            </p>
                        )}
                        {hasUsableResume && onReplaceResume && (
                            <button
                                type="button"
                                data-testid="jobs-replace-resume"
                                onClick={onReplaceResume}
                                className="inline-flex min-h-11 items-center text-xs font-semibold text-foreground transition-colors hover:text-brand"
                            >
                                Replace
                            </button>
                        )}
                    </div>
                ) : null}
            </div>

            <PreferenceChipStrip chips={prefsChips} className="mb-4 shrink-0" />

            {showLoading ? (
                <div
                    data-testid="for-you-loading"
                    className="flex min-h-0 flex-1 items-center justify-center border border-border bg-card p-12"
                >
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CircleNotch size={18} className="animate-spin" aria-hidden />
                        Finding roles matched to your résumé…
                    </p>
                </div>
            ) : visiblePacks.length === 0 ? (
                <div
                    data-testid="for-you-empty"
                    className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 border border-border bg-card p-12 text-center"
                >
                    <p className="text-sm text-muted-foreground">
                        No ranked roles to show right now. Try Search to browse the full list.
                    </p>
                    {showToggle && (
                        <Button type="button" variant="outline" onClick={() => onHomeViewChange("search")}>
                            Go to Search
                        </Button>
                    )}
                </div>
            ) : (
                <ForYouDeck
                    packs={visiblePacks}
                    activeIndex={activeIndex}
                    onActiveIndexChange={onActiveIndexChange}
                    matchScores={matchScores}
                    resume={resume}
                    nowMs={nowMs}
                    hydratedJobs={hydratedJobs}
                    onActivePackChange={onActivePackChange}
                    className="min-h-0 flex-1"
                />
            )}

            {visiblePacks.length > 0 && !showLoading && (
                <div className="mt-4 shrink-0 border-t border-border pt-4">
                    {!resume && onReplaceResume && (
                        <div className="mb-3 space-y-2">
                            <p className="text-xs text-muted-foreground">
                                Upload a résumé to download a tailored PDF
                            </p>
                            <button
                                type="button"
                                data-testid="for-you-upload-resume"
                                onClick={onReplaceResume}
                                className="inline-flex min-h-11 items-center text-xs font-semibold text-foreground transition-colors hover:text-brand"
                            >
                                Upload résumé
                            </button>
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
                                "Download & apply"
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
 *  Same frame as For you — never Search chrome. */
export function ForYouHomePending() {
    return (
        <div className={FOR_YOU_HOME_FRAME_CLASS} data-testid="for-you-home-pending">
            <div className="min-h-0 flex-1 border border-border bg-card" />
        </div>
    );
}
