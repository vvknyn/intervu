"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ForYouHome } from "@/components/jobs/for-you/ForYouHome";
import {
    MOCK_FOR_YOU_DECK_JOBS,
    MOCK_FOR_YOU_DECK_NOW_MS,
    MOCK_FOR_YOU_DECK_RESUME,
    MOCK_FOR_YOU_SAVE_DELAY_MS,
    mockForYouDeckMatchScores,
} from "@/lib/jobs/for-you/mock-deck-fixtures";
import { buildOptimisticPursuit } from "@/lib/pursuits/optimistic-pursuit";
import type { Pursuit } from "@/lib/pursuits/types";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * Fixture-driven `/mock/for-you-deck` — real `ForYouHome` / `ForYouDeck` /
 * `ForYouPack` with static jobs and band-only fit labels. No Meili, WorkOS,
 * or hub navigation. Query flags:
 *   `?firstRevealEnter=1` — `enter-reveal` on the active pack
 *   `?firstRevealFocus=1` — focus `for-you-download-apply` once (CRAFT-3)
 */
function ForYouDeckMockInner() {
    const params = useSearchParams();
    const firstRevealEnter = params.get("firstRevealEnter") === "1";
    const firstRevealFocus = params.get("firstRevealFocus") === "1";

    const [packs, setPacks] = useState<PublicJob[]>(() => [...MOCK_FOR_YOU_DECK_JOBS]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [firstRevealFocusDone, setFirstRevealFocusDone] = useState(false);
    const [confirmedPursuits, setConfirmedPursuits] = useState<Map<string, Pursuit>>(() => new Map());
    const [optimisticPursuits, setOptimisticPursuits] = useState<Map<string, Pursuit>>(() => new Map());
    const [savePulseJobIds, setSavePulseJobIds] = useState<Set<string>>(() => new Set());
    const saveInFlightRef = useRef<Set<string>>(new Set());

    const activeJob = packs[activeIndex] ?? null;
    const matchScores = useMemo(() => mockForYouDeckMatchScores(), []);
    const hydratedJobs = useMemo(
        () => new Map(packs.map((job) => [job.id, { job, descriptionPending: false }] as const)),
        [packs],
    );

    const pursuitsByJobIdMerged = useMemo(() => {
        const merged = new Map(confirmedPursuits);
        for (const [jobId, pursuit] of optimisticPursuits) {
            merged.set(jobId, pursuit);
        }
        return merged;
    }, [confirmedPursuits, optimisticPursuits]);

    const activePursuit = activeJob ? pursuitsByJobIdMerged.get(activeJob.id) : undefined;

    const handleSkip = useCallback(() => {
        setPacks((prev) => {
            if (prev.length === 0) return prev;
            const idx = Math.min(activeIndex, prev.length - 1);
            const next = prev.filter((_, i) => i !== idx);
            const newIdx = idx >= next.length ? Math.max(0, next.length - 1) : idx;
            setActiveIndex(newIdx);
            return next;
        });
    }, [activeIndex]);

    const handleGoAfter = useCallback((job: PublicJob) => {
        if (saveInFlightRef.current.has(job.id)) return;
        if (pursuitsByJobIdMerged.has(job.id)) return;
        saveInFlightRef.current.add(job.id);
        setOptimisticPursuits((prev) => {
            const next = new Map(prev);
            next.set(job.id, buildOptimisticPursuit(job));
            return next;
        });
        setSavePulseJobIds((prev) => new Set(prev).add(job.id));
        void (async () => {
            await new Promise((resolve) => setTimeout(resolve, MOCK_FOR_YOU_SAVE_DELAY_MS));
            const serverRow: Pursuit = {
                ...buildOptimisticPursuit(job),
                id: `mock-pursuit-${job.id}`,
                user_id: "mock-user",
            };
            setOptimisticPursuits((prev) => {
                const next = new Map(prev);
                next.delete(job.id);
                return next;
            });
            setConfirmedPursuits((prev) => {
                const next = new Map(prev);
                next.set(job.id, serverRow);
                return next;
            });
            saveInFlightRef.current.delete(job.id);
        })();
    }, [pursuitsByJobIdMerged]);

    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-6" data-testid="for-you-deck-mock-root">
            <ForYouHome
                visiblePacks={packs}
                activeIndex={activeIndex}
                onActiveIndexChange={setActiveIndex}
                activeJob={activeJob}
                onSkip={handleSkip}
                matchScores={matchScores}
                resume={MOCK_FOR_YOU_DECK_RESUME}
                // No signals: the fixture deck has no search to count or filter against (no Meili).
                signals={null}
                nowMs={MOCK_FOR_YOU_DECK_NOW_MS}
                fitResolving={false}
                loading={false}
                loadError={null}
                onRetryLoad={() => {}}
                fitActive
                hydratedJobs={hydratedJobs}
                onActivePackChange={() => {}}
                onOpenPosting={() => {}}
                onHomeViewChange={() => {}}
                showSearchCta={false}
                hasUsableResume
                firstRevealEnter={firstRevealEnter}
                firstRevealDeckFocus={firstRevealFocus && !firstRevealFocusDone}
                onFirstRevealFocusDone={() => setFirstRevealFocusDone(true)}
                activePursuit={activePursuit}
                onGoAfter={handleGoAfter}
                saveSuccessPulse={activeJob ? savePulseJobIds.has(activeJob.id) : false}
            />
        </div>
    );
}

export function ForYouDeckMock() {
    return (
        <Suspense fallback={<div data-testid="for-you-deck-mock-loading" className="p-6 text-sm text-muted-foreground" />}>
            <ForYouDeckMockInner />
        </Suspense>
    );
}
