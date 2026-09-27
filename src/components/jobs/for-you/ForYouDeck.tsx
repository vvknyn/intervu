"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ForYouPack } from "@/components/jobs/for-you/ForYouPack";
import { prefetchIndexesAhead } from "@/lib/jobs/for-you/deck-active-job";
import { resolveDescriptionHydration } from "@/lib/jobs/for-you/description-pane-state";
import {
    deckCommitUsesDeckAnimation,
    flushInstantDeckCommit,
    reduceDeckAnimationEnd,
    shouldAcceptDeckAnimationEnd,
    type DeckMotionRole,
} from "@/lib/jobs/for-you/deck-motion-lifecycle";
import {
    computeDeckDragOffset,
    resolveDeckSwipe,
    type DeckSwipeDirection,
} from "@/lib/jobs/for-you/deck-swipe";
import {
    isVerticalDominantMove,
    shouldActivateDeckHorizontalDrag,
} from "@/lib/jobs/for-you/deck-pointer-intent";
import {
    getPrefersReducedMotionServerSnapshot,
    getPrefersReducedMotionSnapshot,
    prefersReducedMotion,
    subscribePrefersReducedMotion,
} from "@/lib/motion/interaction-contract";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";

export const FOR_YOU_PREFETCH_AHEAD = 3;

export interface ForYouDeckProps {
    packs: PublicJob[];
    activeIndex: number;
    matchScores: Map<string, MatchScore | null> | null;
    resume: ResumeData | null;
    nowMs: number;
    hydratedJobs: Map<string, { job: PublicJob; descriptionPending: boolean }>;
    onActivePackChange: (jobId: string) => void;
    onRetryDescription?: (jobId: string) => void;
    onSwipeNavigate?: (direction: "previous" | "next") => void;
    firstReveal?: boolean;
    className?: string;
}

type DeckPhase = "idle" | "drag" | "commit-out" | "commit-in" | "commit-cross";

function deckExitClass(dir: DeckSwipeDirection): string {
    if (dir === "next") return "deck-exit-next";
    if (dir === "previous") return "deck-exit-previous";
    return "";
}

function deckEnterClass(dir: DeckSwipeDirection): string {
    if (dir === "next") return "deck-enter-next";
    if (dir === "previous") return "deck-enter-previous";
    return "";
}

function PackSlot({
    pack,
    hydratedJobs,
    matchScores,
    resume,
    nowMs,
    onRetryDescription,
    className,
}: {
    pack: PublicJob;
    hydratedJobs: Map<string, { job: PublicJob; descriptionPending: boolean }>;
    matchScores: Map<string, MatchScore | null> | null;
    resume: ResumeData | null;
    nowMs: number;
    onRetryDescription?: (jobId: string) => void;
    className?: string;
}) {
    const hydrated = resolveDescriptionHydration(pack, hydratedJobs.get(pack.id));
    return (
        <ForYouPack
            key={pack.id}
            job={pack}
            hydratedJob={hydrated.job}
            descriptionPending={hydrated.descriptionPending}
            matchScore={matchScores?.get(pack.id) ?? null}
            resume={resume}
            nowMs={nowMs}
            onRetryDescription={onRetryDescription ? () => onRetryDescription(pack.id) : undefined}
            className={className}
        />
    );
}

export function ForYouDeck({
    packs,
    activeIndex,
    matchScores,
    resume,
    nowMs,
    hydratedJobs,
    onActivePackChange,
    onRetryDescription,
    onSwipeNavigate,
    firstReveal = false,
    className,
}: ForYouDeckProps) {
    useEffect(() => {
        const job = packs[activeIndex];
        if (job) onActivePackChange(job.id);
        for (const index of prefetchIndexesAhead(activeIndex, packs.length, FOR_YOU_PREFETCH_AHEAD)) {
            onActivePackChange(packs[index].id);
        }
    }, [activeIndex, packs, onActivePackChange]);

    const shellRef = useRef<HTMLDivElement>(null);
    const pointerCandidate = useRef<{ x: number; y: number; pointerId: number } | null>(null);
    const pointerActivated = useRef(false);
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const prevIndexRef = useRef(activeIndex);
    const phaseRef = useRef<DeckPhase>("idle");
    const commitDirRef = useRef<DeckSwipeDirection>(null);

    const reducedMotion = useSyncExternalStore(
        subscribePrefersReducedMotion,
        getPrefersReducedMotionSnapshot,
        getPrefersReducedMotionServerSnapshot,
    );

    const [phase, setPhase] = useState<DeckPhase>("idle");
    const [dragDx, setDragDx] = useState(0);
    const [commitFromIndex, setCommitFromIndex] = useState<number | null>(null);
    const [commitDir, setCommitDir] = useState<DeckSwipeDirection>(null);

    phaseRef.current = phase;
    commitDirRef.current = commitDir;

    const resetMotion = useCallback(() => {
        setPhase("idle");
        setDragDx(0);
        setCommitFromIndex(null);
        setCommitDir(null);
    }, []);

    const clearPointerGesture = useCallback((event?: React.PointerEvent) => {
        pointerCandidate.current = null;
        pointerActivated.current = false;
        if (event) {
            try {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
            } catch {
                /* ignored */
            }
        }
    }, []);

    const beginSwipeCommit = useCallback(
        (dir: NonNullable<DeckSwipeDirection>) => {
            if (!onSwipeNavigate) return;
            if (!deckCommitUsesDeckAnimation(prefersReducedMotion())) {
                onSwipeNavigate(dir);
                return;
            }
            setCommitFromIndex(activeIndex);
            setCommitDir(dir);
            setPhase("commit-out");
            setDragDx(0);
        },
        [activeIndex, onSwipeNavigate],
    );

    const handleLayerAnimationEnd = useCallback(
        (role: DeckMotionRole) => (event: React.AnimationEvent<HTMLDivElement>) => {
            if (!deckCommitUsesDeckAnimation(prefersReducedMotion())) return;
            const direction = commitDirRef.current;
            if (
                !shouldAcceptDeckAnimationEnd({
                    phase: phaseRef.current,
                    role,
                    direction,
                    animationName: event.animationName,
                    eventTarget: event.target,
                    currentTarget: event.currentTarget,
                })
            ) {
                return;
            }
            const result = reduceDeckAnimationEnd(phaseRef.current, role);
            if (result.kind === "enter-incoming" && onSwipeNavigate && direction) {
                onSwipeNavigate(direction);
                setPhase("commit-in");
                return;
            }
            if (result.kind === "reset-idle") {
                resetMotion();
            }
        },
        [onSwipeNavigate, resetMotion],
    );

    useLayoutEffect(() => {
        const prev = prevIndexRef.current;
        if (prev === activeIndex) return;
        prevIndexRef.current = activeIndex;

        if (!deckCommitUsesDeckAnimation(prefersReducedMotion())) return;
        if (phaseRef.current !== "idle") return;

        const dir: DeckSwipeDirection = activeIndex > prev ? "next" : "previous";
        setCommitFromIndex(prev);
        setCommitDir(dir);
        setPhase("commit-cross");
        setDragDx(0);
    }, [activeIndex]);

    useLayoutEffect(() => {
        const flush = flushInstantDeckCommit({
            reducedMotion: prefersReducedMotion(),
            phase: phaseRef.current,
            direction: commitDirRef.current,
        });
        if (flush.action === "none") return;
        if (flush.action === "navigate-then-idle" && onSwipeNavigate) {
            onSwipeNavigate(flush.direction);
        }
        resetMotion();
    }, [phase, reducedMotion, onSwipeNavigate, resetMotion]);

    const activePack = packs[activeIndex];
    if (!activePack) return null;

    const swipeEnabled = Boolean(onSwipeNavigate) && deckCommitUsesDeckAnimation(reducedMotion);

    const handlePointerDown = (event: React.PointerEvent) => {
        if (!swipeEnabled || phaseRef.current.startsWith("commit")) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        pointerCandidate.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        pointerActivated.current = false;
        touchStart.current = null;
    };

    const handlePointerMove = (event: React.PointerEvent) => {
        if (!swipeEnabled || !pointerCandidate.current) return;
        if (pointerCandidate.current.pointerId !== event.pointerId) return;

        const dx = event.clientX - pointerCandidate.current.x;
        const dy = event.clientY - pointerCandidate.current.y;

        if (!pointerActivated.current) {
            if (isVerticalDominantMove(dx, dy)) {
                pointerCandidate.current = null;
                return;
            }
            if (!shouldActivateDeckHorizontalDrag({ dx, dy, alreadyActivated: false })) {
                return;
            }
            pointerActivated.current = true;
            setPhase("drag");
            setDragDx(0);
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                /* ignored */
            }
        }

        if (phaseRef.current !== "drag") return;
        if (isVerticalDominantMove(dx, dy)) return;
        const width = shellRef.current?.clientWidth ?? 0;
        setDragDx(computeDeckDragOffset(dx, width));
    };

    const endPointerGesture = (event: React.PointerEvent) => {
        if (!pointerCandidate.current || pointerCandidate.current.pointerId !== event.pointerId) {
            return;
        }
        const dx = event.clientX - pointerCandidate.current.x;
        const dy = event.clientY - pointerCandidate.current.y;
        const wasActivated = pointerActivated.current;
        clearPointerGesture(event);

        if (!wasActivated || phaseRef.current !== "drag") return;
        const direction = resolveDeckSwipe({ dx, dy });
        if (direction) {
            beginSwipeCommit(direction);
            return;
        }
        setPhase("idle");
        setDragDx(0);
    };

    const handlePointerCancel = (event: React.PointerEvent) => {
        clearPointerGesture(event);
        if (phaseRef.current === "drag") {
            setPhase("idle");
            setDragDx(0);
        }
    };

    const handleTouchStart = (event: React.TouchEvent) => {
        if (!swipeEnabled || pointerCandidate.current) return;
        const t = event.changedTouches[0];
        if (!t) return;
        touchStart.current = { x: t.clientX, y: t.clientY };
    };

    const handleTouchEnd = (event: React.TouchEvent) => {
        if (!onSwipeNavigate || !deckCommitUsesDeckAnimation(prefersReducedMotion()) || pointerCandidate.current)
            return;
        if (phaseRef.current !== "idle" || !touchStart.current) return;
        const t = event.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - touchStart.current.x;
        const dy = t.clientY - touchStart.current.y;
        touchStart.current = null;
        const direction = resolveDeckSwipe({ dx, dy });
        if (direction) beginSwipeCommit(direction);
    };

    const outgoingIndex =
        phase === "commit-out" || phase === "commit-cross" ? (commitFromIndex ?? activeIndex) : null;
    const outgoingPack = outgoingIndex != null ? packs[outgoingIndex] : null;

    const dragStyle =
        phase === "drag" && swipeEnabled ? { transform: `translateX(${dragDx}px)` } : undefined;

    const motionAnimated = deckCommitUsesDeckAnimation(prefersReducedMotion());
    const showCross = motionAnimated && phase === "commit-cross" && outgoingPack && commitDir;
    const showOutOnly = motionAnimated && phase === "commit-out" && outgoingPack && commitDir;
    const showInOnly = motionAnimated && phase === "commit-in" && commitDir;

    return (
        <div
            ref={shellRef}
            className={cn("for-you-deck-shell relative touch-pan-y", className)}
            data-testid="for-you-deck"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPointerGesture}
            onPointerCancel={handlePointerCancel}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {showCross ? (
                <>
                    <div
                        data-deck-role="outgoing"
                        className={cn("deck-card-layer absolute inset-x-0 top-0", deckExitClass(commitDir))}
                        onAnimationEnd={handleLayerAnimationEnd("outgoing")}
                    >
                        <PackSlot
                            pack={outgoingPack!}
                            hydratedJobs={hydratedJobs}
                            matchScores={matchScores}
                            resume={resume}
                            nowMs={nowMs}
                            onRetryDescription={onRetryDescription}
                        />
                    </div>
                    <div
                        data-deck-role="incoming"
                        className={cn("deck-card-layer relative", deckEnterClass(commitDir))}
                        onAnimationEnd={handleLayerAnimationEnd("incoming")}
                    >
                        <PackSlot
                            pack={activePack}
                            hydratedJobs={hydratedJobs}
                            matchScores={matchScores}
                            resume={resume}
                            nowMs={nowMs}
                            onRetryDescription={onRetryDescription}
                            className={firstReveal ? "enter-reveal" : undefined}
                        />
                    </div>
                </>
            ) : showOutOnly ? (
                <div
                    data-deck-role="outgoing"
                    className={cn("deck-card-layer relative", deckExitClass(commitDir))}
                    onAnimationEnd={handleLayerAnimationEnd("outgoing")}
                >
                    <PackSlot
                        pack={outgoingPack!}
                        hydratedJobs={hydratedJobs}
                        matchScores={matchScores}
                        resume={resume}
                        nowMs={nowMs}
                        onRetryDescription={onRetryDescription}
                    />
                </div>
            ) : showInOnly ? (
                <div
                    data-deck-role="incoming"
                    className={cn("deck-card-layer relative", deckEnterClass(commitDir))}
                    onAnimationEnd={handleLayerAnimationEnd("incoming")}
                >
                    <PackSlot
                        pack={activePack}
                        hydratedJobs={hydratedJobs}
                        matchScores={matchScores}
                        resume={resume}
                        nowMs={nowMs}
                        onRetryDescription={onRetryDescription}
                        className={firstReveal ? "enter-reveal" : undefined}
                    />
                </div>
            ) : (
                <div
                    className={cn("deck-card-layer relative", firstReveal && phase === "idle" ? "enter-reveal" : null)}
                    style={dragStyle}
                >
                    <PackSlot
                        pack={activePack}
                        hydratedJobs={hydratedJobs}
                        matchScores={matchScores}
                        resume={resume}
                        nowMs={nowMs}
                        onRetryDescription={onRetryDescription}
                    />
                </div>
            )}
        </div>
    );
}
