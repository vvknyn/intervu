"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clampDeckIndex } from "@/lib/jobs/for-you/deck-index";
import { collapseByEmployer, slotLeads, type EmployerSlot } from "@/lib/jobs/for-you/employer-slot";
import {
    fallbackActiveId,
    findActiveIndexById,
    nextActiveIdAfterSkip,
} from "@/lib/jobs/for-you/deck-active-job";
import { reachedIds, summarizeTuning, tuneDeck, type TuneRank, type TuningSignal } from "@/lib/jobs/for-you/tuning";
import { clearNudge, recordNudge, resetNudges, useDeckNudges } from "@/lib/jobs/for-you/tuning-store";
import type { PublicJob } from "@/lib/jobs/types";
import { useTuningReason } from "@/hooks/use-tuning-reason";

const NO_IDS: readonly string[] = [];

/**
 * Owns for-you deck progress (active card + skipped ids) at the seam that
 * survives a Search <-> For-you toggle. `page.tsx` calls this unconditionally
 * and never unmounts across that toggle; `ForYouHome`/`ForYouDeck` below it
 * do unmount (the toggle renders one branch or the other). State that must
 * outlive the toggle cannot live inside the branch the toggle switches — it
 * has to live one level up, here.
 *
 * The active card is tracked by job id (`activeJobId`), not by index.
 * `packs` keeps tracking Search results while the user is toggled away
 * (needed so a resize doesn't zero the index -- see the effect below), and
 * `renderedClusters` upstream re-sorts as match scores resolve even with no
 * toggle at all. An index into a list that reorders or resizes for reasons
 * other than the user's own skip is not a stable reference to "the card the
 * user is looking at"; an id is.
 *
 * The deck holds one card per employer (`collapseByEmployer`): the last step on the list, after the visitor's
 * skips and nudges, so a skipped role hands its slot to the employer's next role and the nudges still order
 * the roles first. `slots` has each employer's other roles, by the lead's id, for the card to show. A nudge reads
 * the whole tuned list, the employers' other roles included: "away from Acme" is about the roles that share Acme
 * with the one turned down, which ride inside its card.
 *
 * It also applies the visitor's "more / fewer like this" nudges (tuning.ts):
 * the roles still to come are reordered by them, the ones already reached
 * (`passedIds`) never move. `isOwnRole` says which roles are the candidate's
 * own kind of role, so a thumbs-down on one steers by what else sets it apart.
 * `tuneRankOf` says where each role sits before any nudge (`tuneRank`, band-order.ts): a nudge keeps a role in its
 * fit band and never lifts a title the résumé does not hold over one it does.
 */
export function useForYouDeck(
    packs: PublicJob[],
    isOwnRole?: (job: PublicJob) => boolean,
    tuneRankOf?: (job: PublicJob, nowMs: number) => TuneRank | null,
) {
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
    const [passedIds, setPassedIds] = useState<readonly string[]>(NO_IDS);
    const nudges = useDeckNudges();
    const [nowMs] = useState(() => Date.now());
    // The optional "why?" after a more/fewer tap (use-tuning-reason.ts).
    const { prompt: whyPrompt, ask: askWhy, dismiss: dismissWhy, dismissFor: dismissWhyFor } = useTuningReason("deck");

    const unskipped = useMemo(() => packs.filter((p) => !skippedIds.has(p.id)), [packs, skippedIds]);
    const tuned = useMemo(
        () => tuneDeck(unskipped, nudges, passedIds, nowMs, tuneRankOf && ((job) => tuneRankOf(job, nowMs))),
        [unskipped, nudges, passedIds, nowMs, tuneRankOf],
    );
    const employerSlots = useMemo(() => collapseByEmployer(tuned, (job) => job), [tuned]);
    const visiblePacks = useMemo(() => slotLeads(employerSlots), [employerSlots]);
    const slots = useMemo(() => new Map(employerSlots.map((slot) => [slot.lead.id, slot] as const)), [employerSlots]);

    const activeIndex = useMemo(() => {
        const idx = findActiveIndexById(visiblePacks, activeJobId);
        return idx === -1 ? 0 : idx;
    }, [visiblePacks, activeJobId]);

    // The active job stays active by id even when `visiblePacks` reorders.
    // When it's missing for any reason other than the skip below (which
    // repairs the id itself, synchronously, before this can even run) --
    // a replaced or filtered list, or first mount -- fall back to the
    // first card. A replaced list starts over: nothing in it was reached.
    useEffect(() => {
        if (visiblePacks.length === 0) {
            if (activeJobId !== null) setActiveJobId(null);
            return;
        }
        if (findActiveIndexById(visiblePacks, activeJobId) !== -1) return;
        if (activeJobId !== null) setPassedIds(NO_IDS);
        setActiveJobId(fallbackActiveId(visiblePacks));
    }, [visiblePacks, activeJobId]);

    const activeJob = visiblePacks[activeIndex] ?? null;

    // Stepping to a role marks every role up to it as reached. The first card
    // alone is not, so a list still re-sorting as its scores arrive keeps doing so.
    const setActiveIndex = useCallback(
        (index: number) => {
            const clamped = clampDeckIndex(index, visiblePacks.length);
            const nextId = visiblePacks[clamped]?.id ?? null;
            // Moving to another role drops an unanswered "why?": it shows on the open role's card,
            // and would otherwise ask about the role left behind on the next one's.
            if (nextId !== activeJobId) dismissWhy();
            setActiveJobId(nextId);
            if (clamped > 0 || passedIds.length > 0) setPassedIds(reachedIds(visiblePacks, passedIds, clamped));
        },
        [visiblePacks, passedIds, activeJobId, dismissWhy],
    );

    /** Back to the top of a newly opened pack. */
    const restart = useCallback(() => {
        setActiveJobId(null);
        setPassedIds(NO_IDS);
        dismissWhy();
    }, [dismissWhy]);

    // Skipping removes the active card from `visiblePacks`. The job that
    // slides into its former slot becomes active by id -- not the first
    // card, and not whatever a stale index would now point at -- so a
    // later re-sort still finds the right job instead of drifting by
    // position. (This is also the fix for the old double-advance bug: only
    // one state update decides the next active job, not an index bump
    // *plus* the resize effect both moving it.) A skip nudges the roles to
    // come away from this one, so the slot is filled from the retuned order.
    const removeActive = useCallback(
        (signal: "skip" | "fewer") => {
            if (!activeJob) return;
            const skippedId = activeJob.id;
            const own = isOwnRole?.(activeJob) ?? false;
            const nextNudges = recordNudge(activeJob, signal, tuned, { own });
            if (signal === "fewer") askWhy({ job: activeJob, signal, deck: tuned, own });
            else dismissWhy();
            const before = visiblePacks.slice(0, activeIndex).map((p) => p.id);
            const remaining = slotLeads(
                collapseByEmployer(
                    tuneDeck(
                        unskipped.filter((p) => p.id !== skippedId),
                        nextNudges,
                        before,
                        nowMs,
                        tuneRankOf && ((job) => tuneRankOf(job, nowMs)),
                    ),
                    (job) => job,
                ),
            );
            setSkippedIds((prev) => new Set(prev).add(skippedId));
            setPassedIds(before);
            setActiveJobId(nextActiveIdAfterSkip(remaining, activeIndex));
        },
        [activeJob, activeIndex, visiblePacks, tuned, unskipped, nowMs, isOwnRole, tuneRankOf, askWhy, dismissWhy],
    );
    const handleSkip = useCallback(() => removeActive("skip"), [removeActive]);
    const handleFewer = useCallback(() => removeActive("fewer"), [removeActive]);

    // Any other signal on the open role: the roles up to it stay put, the rest retune.
    const nudgeActive = useCallback(
        (signal: Exclude<TuningSignal, "skip" | "fewer">) => {
            if (!activeJob) return;
            setPassedIds(reachedIds(visiblePacks, passedIds, activeIndex));
            recordNudge(activeJob, signal, tuned, { own: isOwnRole?.(activeJob) ?? false });
        },
        [activeJob, activeIndex, visiblePacks, tuned, passedIds, isOwnRole],
    );

    // "More like this" is a toggle: a second tap takes it back.
    const likedIds = useMemo(
        () => new Set(nudges.filter((n) => n.signal === "more").map((n) => n.jobId)),
        [nudges],
    );
    const handleMore = useCallback(() => {
        if (!activeJob) return;
        if (likedIds.has(activeJob.id)) {
            clearNudge(activeJob.id);
            dismissWhyFor(activeJob.id);
        } else {
            nudgeActive("more");
            askWhy({ job: activeJob, signal: "more", deck: tuned, own: isOwnRole?.(activeJob) ?? false });
        }
    }, [activeJob, likedIds, nudgeActive, askWhy, dismissWhyFor, tuned, isOwnRole]);

    const tuning = useMemo(() => summarizeTuning(nudges, nowMs), [nudges, nowMs]);
    // A reason arrives after the deck has moved on to the next role: that role and everything
    // before it stay where they are, so the re-tune can never slip a role in behind the one on
    // screen, where it would be passed unseen. Only the roles still to come move.
    const tuningReason = useMemo(
        () =>
            whyPrompt
                ? {
                      ...whyPrompt,
                      choose: (reason: Parameters<typeof whyPrompt.choose>[0]) => {
                          setPassedIds(reachedIds(visiblePacks, passedIds, activeIndex));
                          whyPrompt.choose(reason);
                      },
                  }
                : null,
        [whyPrompt, visiblePacks, passedIds, activeIndex],
    );
    const resetTuning = useCallback(() => {
        setPassedIds(reachedIds(visiblePacks, passedIds, activeIndex));
        resetNudges();
        dismissWhy();
    }, [visiblePacks, passedIds, activeIndex, dismissWhy]);

    return {
        visiblePacks,
        /** Each card's employer: its other roles in the deck and how many it does not show, by the card's role id. */
        slots: slots as ReadonlyMap<string, EmployerSlot<PublicJob>>,
        activeIndex,
        setActiveIndex,
        restart,
        activeJob,
        handleSkip,
        handleFewer,
        handleMore,
        nudgeActive,
        likedIds,
        tuning,
        resetTuning,
        /** "Fewer / more like {role} — why?", or null (TuningReasonPrompt). */
        tuningReason,
    };
}
