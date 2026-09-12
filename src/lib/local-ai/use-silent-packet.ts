"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readLocalAiEnabled } from "./flag";
import { readLocalAiConsent } from "./consent";
import { readSilentPacketCache, writeSilentPacketCache } from "./silent-packet-cache";
import {
    createSilentPacketPrewarm,
    getOrRunSilentPacketPrewarm,
    isSilentPacketDraftReady,
    resumeFingerprint,
    shouldPrewarmSilentPacket,
    silentPacketCacheKey,
} from "./silent-packet";
import { jobToTailorInput, tailorResumeForJob } from "./tailor-with-engine";
import { scoreJobAgainstResume } from "@/lib/match/score";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import type { TailorDraft } from "./tailor-resume";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export type SilentPacketStatus = "idle" | "warming" | "ready";

export interface UseSilentPacketResult {
    status: SilentPacketStatus;
    cachedDraft: TailorDraft | null;
    showReviewPacket: boolean;
}

export function useSilentPacket(job: PublicJob, resume: ResumeData | null): UseSilentPacketResult {
    const [status, setStatus] = useState<SilentPacketStatus>("idle");
    const [cachedDraft, setCachedDraft] = useState<TailorDraft | null>(null);
    const prewarmRef = useRef<ReturnType<typeof createSilentPacketPrewarm> | null>(null);

    const fitTotal = useMemo(() => {
        if (!resume) return null;
        return scoreJobAgainstResume(resume, job)?.total ?? null;
    }, [resume, job]);

    const cacheKey = useMemo(() => {
        if (!resume) return null;
        return silentPacketCacheKey(job.id, resumeFingerprint(resume));
    }, [job.id, resume]);

    const loadFromCache = useCallback(
        (key: string): TailorDraft | null => {
            const draft = readSilentPacketCache(key);
            if (!isSilentPacketDraftReady(draft)) return null;
            return draft;
        },
        [],
    );

    useEffect(() => {
        if (!cacheKey) {
            setStatus("idle");
            setCachedDraft(null);
            return;
        }

        const draft = loadFromCache(cacheKey);
        if (draft) {
            setCachedDraft(draft);
            setStatus("ready");
            return;
        }

        setCachedDraft(null);
        setStatus("idle");
    }, [cacheKey, loadFromCache]);

    useEffect(() => {
        prewarmRef.current?.cancel();
        prewarmRef.current = null;

        if (!resume || !cacheKey) return;
        if (!readLocalAiEnabled() || !resumeIsUsable(resume)) return;
        if (!shouldPrewarmSilentPacket({ localAiEnabled: true, resumeUsable: true, fitTotal })) {
            return;
        }
        if (loadFromCache(cacheKey)) {
            return;
        }

        const prewarm = createSilentPacketPrewarm(() => {
            const cached = loadFromCache(cacheKey);
            if (cached) {
                setCachedDraft(cached);
                setStatus("ready");
                return;
            }

            const runGeneration = prewarm.captureRunGeneration();
            setStatus("warming");

            const allowModel = readLocalAiConsent();
            void getOrRunSilentPacketPrewarm(cacheKey, () =>
                tailorResumeForJob(resume, jobToTailorInput(job), { allowModel }),
            )
                .then((draft) => {
                    if (!prewarm.shouldApplyRun(runGeneration)) return;
                    if (!isSilentPacketDraftReady(draft)) {
                        setStatus("idle");
                        setCachedDraft(null);
                        return;
                    }
                    writeSilentPacketCache(cacheKey, draft);
                    setCachedDraft(draft);
                    setStatus("ready");
                })
                .catch(() => {
                    if (!prewarm.shouldApplyRun(runGeneration)) return;
                    setStatus("idle");
                    setCachedDraft(null);
                });
        });

        prewarmRef.current = prewarm;
        prewarm.schedule();

        return () => {
            prewarm.cancel();
            prewarmRef.current = null;
        };
    }, [job, resume, cacheKey, fitTotal, loadFromCache]);

    const showReviewPacket = status === "ready" || status === "warming";

    return { status, cachedDraft, showReviewPacket };
}
