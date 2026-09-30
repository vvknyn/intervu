"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { goAfterJobAction } from "@/actions/application";
import { markJobAppliedAction } from "@/actions/jobs";
import { reportJobEnabledAction } from "@/actions/report-job";
import { AuthPopover } from "@/components/auth/auth-popover";
import { useAuthGate } from "@/components/auth/use-auth-gate";
import { ApplyIntentDialog } from "@/components/jobs/ApplyIntentDialog";
import { openApplyUrl, useGatedApply } from "@/components/jobs/use-gated-apply";
import { ApplyReturnPrompt, useApplyReturnPrompt, type ApplyReturnJob } from "@/components/jobs/ApplyReturnPrompt";
import { GuestApplyTrackPrompt, type GuestApplyTrackRecord } from "@/components/jobs/GuestApplyTrackPrompt";
import { recordAuthGateOpen } from "@/lib/auth/open-auth-gate";
import type { AuthGateTrigger } from "@/lib/auth/auth-gate-copy";
import { fetchResumeData } from "@/actions/resume";
import { JobDetail, JobDetailActionBar } from "@/components/jobs/JobDetail";
import { JobDetailDocument } from "@/components/jobs/JobDetailDocument";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import {
    formatAuthGateValueLine,
    GUEST_SAVE_TOAST,
    type AuthGateReason,
} from "@/lib/auth/auth-gate-copy";
import { guestSaveGateReached, recordGuestSave } from "@/lib/auth/guest-save-gate";
import { shouldPromptApplyIntent } from "@/lib/jobs/apply-intent";
import { shortDate } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { captureEvent, type EventSource } from "@/lib/analytics/events";
import { matchAnalyticsProps } from "@/lib/analytics/match-props";
import { classifySentinel } from "@/lib/llm/sentinels";
import { scoreJobAgainstResume } from "@/lib/match/score";
import { addGuestPursuit, listGuestPursuits } from "@/lib/pursuits/guest-store";
import { hasReachedStage, type Pursuit } from "@/lib/pursuits/types";
import {
    buildOptimisticPursuit,
    pruneConfirmedOptimisticPursuits,
} from "@/lib/pursuits/optimistic-pursuit";
import { invalidatePursuitsCache, usePursuits } from "@/lib/pursuits/use-pursuits";
import { hapticTap } from "@/lib/motion/haptic";
import { MOTION_DURATION_MS, prefersReducedMotion } from "@/lib/motion/interaction-contract";
import { readLocalAiResume } from "@/lib/local-ai/resume-storage";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { storedResumeData } from "@/lib/resume/stored-resume-data";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { ResumeData } from "@/types/resume";

export interface PublicJobDetailProps {
    job: PublicJob;
    onClose?: () => void;
    onOpenRelated?: (jobId: string, job?: PublicJob) => void;
    /** When false, parent sheet owns scrolling — no description clamp. SERP mobile sheet passes false. */
    collapseDescription?: boolean;
    /** Passed through to JobDetail — sheet mount uses border-0 bg-transparent shadow-none. */
    detailClassName?: string;
    /** "panel" (default) is the SERP glass panel/modal (`JobDetail`); "document"
     *  is the standalone `/jobs/[slug]` page layout (`JobDetailDocument`). The
     *  same gate/handler wiring below drives both — only the rendered detail
     *  component differs. `JobDetailActionBar` renders unconditionally either
     *  way; it's already the proven sticky action surface for this route. */
    layout?: "panel" | "document";
    /** `job_viewed`'s source. Defaults from `layout` when the caller doesn't
     *  know better: "document" is always a standalone page (no referring
     *  surface to name), "panel" defaults to "serp" (the SERP's own inline
     *  `<JobDetail>` render — jobs/page.tsx — passes "serp" explicitly, so
     *  this default only covers other panel callers, e.g. CompanyRoleSearch's
     *  "co"). */
    source?: EventSource;
}

const subscribeNever = () => () => {};

/**
 * Client-side wiring for `JobDetail`/`JobDetailDocument` on standalone or
 * modal job views. Apply/save gates and the sticky action bar match `/jobs`
 * (SERP) behavior.
 */
export function PublicJobDetail({
    job,
    onClose,
    onOpenRelated,
    collapseDescription = true,
    detailClassName,
    layout = "panel",
    source,
}: PublicJobDetailProps) {
    const effectiveSource: EventSource = source ?? (layout === "document" ? "direct" : "serp");
    const [nowMs] = useState(() => Date.now());
    const [optimisticPursuits, setOptimisticPursuits] = useState<Map<string, Pursuit>>(() => new Map());
    const [savePulse, setSavePulse] = useState(false);
    const saveInFlightRef = useRef<Set<string>>(new Set());
    const [applyIntentOpen, setApplyIntentOpen] = useState(false);
    const [user, setUser] = useState<User | null>(() => getCurrentUser());
    const [authReady, setAuthReady] = useState(() => getCurrentUser() !== null);
    const [resumeSettled, setResumeSettled] = useState(false);
    const [authGateReason, setAuthGateReason] = useState<AuthGateReason | null>(null);
    const [authTrigger, setAuthTrigger] = useState<AuthGateTrigger>("user");
    const [guestTrackPrompt, setGuestTrackPrompt] = useState<GuestApplyTrackRecord | null>(null);
    const router = useRouter();
    const { byJobId } = usePursuits();
    // A guest's tracker lives in localStorage, which the server can't read, so
    // /jobs/[slug] is server-rendered as untracked. Until hydration finishes,
    // render it that way here too, then fill in the bookmark and the tracker
    // line; reading the tracker in the first render failed hydration (React
    // 418) on every guest visit to a role they track.
    const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
    const pursuitsByJobId = useMemo(() => {
        if (!hydrated) return new Map<string, Pursuit>();
        const merged = new Map(byJobId);
        for (const [jobId, pursuit] of optimisticPursuits) {
            merged.set(jobId, pursuit);
        }
        return merged;
    }, [hydrated, byJobId, optimisticPursuits]);

    useEffect(() => {
        setOptimisticPursuits((prev) => pruneConfirmedOptimisticPursuits(prev, byJobId));
    }, [byJobId]);

    const triggerSavePulse = useCallback(() => {
        if (prefersReducedMotion()) return;
        setSavePulse(true);
        window.setTimeout(() => setSavePulse(false), MOTION_DURATION_MS.enter + 20);
    }, []);

    useEffect(
        () =>
            onAuthChange((nextUser) => {
                setUser(nextUser);
                setAuthReady(true);
            }),
        [],
    );

    // Same résumé read path `/jobs` uses (`fetchResumeData` →
    // `resume_last_updated`, see actions/resume.ts) so the detail-header chip
    // can never disagree with the SERP card chip for the same signed-in user.
    const [resume, setResume] = useState<ResumeData | null>(null);
    const [resumeAsOfDate, setResumeAsOfDate] = useState<string | null>(null);
    useEffect(() => {
        if (!authReady) return;

        if (!user) {
            const stored = readLocalAiResume();
            if (stored && resumeIsUsable(stored.data)) {
                setResume(stored.data);
                const ms = Date.parse(stored.updatedAt);
                setResumeAsOfDate(Number.isFinite(ms) ? shortDate(ms).toLowerCase() : null);
            } else {
                setResume(null);
                setResumeAsOfDate(null);
            }
            setResumeSettled(true);
            return;
        }

        let cancelled = false;
        setResumeSettled(false);
        fetchResumeData()
            .then(({ data: stored, text, updatedAt }) => {
                if (cancelled) return;
                const data = storedResumeData(stored, text);
                if (!data || !resumeIsUsable(data)) {
                    setResume(null);
                    setResumeAsOfDate(null);
                    return;
                }
                setResume(data);
                const ms = updatedAt ? Date.parse(updatedAt) : NaN;
                setResumeAsOfDate(Number.isFinite(ms) ? shortDate(ms).toLowerCase() : null);
            })
            .catch(() => {
                if (!cancelled) {
                    setResume(null);
                    setResumeAsOfDate(null);
                }
            })
            .finally(() => {
                if (!cancelled) setResumeSettled(true);
            });
        return () => {
            cancelled = true;
        };
    }, [user, authReady]);
    const matchScore = resume ? scoreJobAgainstResume(resume, job) : null;
    const matchScoreFor = (target: PublicJob) => (resume ? scoreJobAgainstResume(resume, target) : null);
    const matchPending = !authReady || !resumeSettled;

    const [reportJobEnabled, setReportJobEnabled] = useState(false);
    useEffect(() => {
        let cancelled = false;
        reportJobEnabledAction()
            .then((ok) => {
                if (!cancelled) setReportJobEnabled(ok);
            })
            .catch(() => {
                /* transport failure — keep hidden */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // The one auth gate (`use-auth-gate.ts`): signed in → run the handler
    // now; signed out → persist the action (survives both in-place login and
    // a hard OAuth/passkey navigation away and back) and open the popover.
    // `gate` references handlers below only by closure, resolved when the
    // auth gate invokes them, long after this component has finished its
    // first render.
    const { gate, authOpen, setAuthOpen, onAuthed } = useAuthGate<PublicJob>({
        handlers: {
            // Same reasoning as jobs/page.tsx's sibling handler: a guest's
            // Apply click never reached the ATS (auth-first gate), so the
            // replay opens the apply-intent dialog rather than calling
            // `window.open` outside a click gesture. Guard on job id —
            // this route only ever shows one job, but a stale/foreign
            // persisted record must never pop the dialog for it.
            apply: (action) => {
                if (action.payload?.id === job.id) setApplyIntentOpen(true);
            },
            // This surface has no résumé importer — nothing here ever calls
            // `gate({ kind: "upload", ... })`, so this is unreachable. Still
            // required: `AuthGateHandlers` is a mapped type over every
            // `PendingAction` kind, so every caller supplies both.
            upload: () => {},
        },
        user,
        onGateOpen: (reason) => {
            setAuthGateReason(reason);
            setAuthTrigger("user");
        },
    });

    const openAuth = (reason: AuthGateReason | null = null, trigger: AuthGateTrigger = "user") => {
        const effectiveReason = reason ?? "generic";
        if (trigger === "user" && effectiveReason !== "generic") {
            recordAuthGateOpen({
                storage: window.sessionStorage,
                reason: effectiveReason,
                trigger,
                originSurface: "job_detail",
                jobId: job.id,
            });
        }
        setAuthGateReason(reason);
        setAuthTrigger(trigger);
        setAuthOpen(true);
    };

    const openPostingNow = (target: PublicJob) => {
        if (!target.apply_url) return;
        // A1 — only a signed-in departure arms the return prompt; guests
        // already left via this same call but auth for tracking is separate.
        if (user) armApplyReturnJob(target);
        openApplyUrl(target.apply_url);
    };

    const doMarkApplied = async (target: ApplyReturnJob) => {
        if (saveInFlightRef.current.has(target.id)) return;
        const prior = byJobId.get(target.id);
        saveInFlightRef.current.add(target.id);
        setOptimisticPursuits((prev) => {
            const next = new Map(prev);
            next.set(target.id, buildOptimisticPursuit(target as PublicJob, "applied"));
            return next;
        });
        triggerSavePulse();
        try {
            const res = await markJobAppliedAction({
                company: target.company ?? "",
                title: target.title,
                applyUrl: target.apply_url,
                jobId: target.id,
            });
            if (res.error) {
                setOptimisticPursuits((prev) => {
                    const next = new Map(prev);
                    if (prior) next.set(target.id, prior);
                    else next.delete(target.id);
                    return next;
                });
                if (classifySentinel(res.error) === "auth") {
                    openAuth("tracker", "user");
                } else {
                    toast.error(`Could not save: ${res.error}`);
                }
                return;
            }
            invalidatePursuitsCache();
            if (!prefersReducedMotion()) hapticTap("success");
            toast.success("Applied — nice work");
            captureEvent("job_marked_applied", {
                job_id: target.id,
                ...matchAnalyticsProps(target.id === job.id ? matchScoreFor(job) : null),
            });
        } catch (e) {
            setOptimisticPursuits((prev) => {
                const next = new Map(prev);
                if (prior) next.set(target.id, prior);
                else next.delete(target.id);
                return next;
            });
            if (classifySentinel(e) === "auth") {
                openAuth("tracker", "user");
            } else {
                toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
            }
        } finally {
            saveInFlightRef.current.delete(target.id);
        }
    };

    // A1 — shared hook (see jobs/page.tsx's own mount for the sibling
    // comment): this surface's "already applied" is the same
    // `byJobId`/`hasReachedStage` pursuit check, and marking applied from
    // the prompt reuses `doMarkApplied` above rather than a second write path.
    const { prompt: applyReturnPrompt, arm: armApplyReturnJob, markApplied: markApplyReturnApplied, dismiss: dismissApplyReturn } =
        useApplyReturnPrompt({
            isAlreadyApplied: (jobId) => {
                const pursuit = pursuitsByJobId.get(jobId);
                return !!pursuit && hasReachedStage(pursuit, "applied");
            },
            onMarkApplied: doMarkApplied,
        });

    // Job 2 gate — same shared chokepoint as jobs/page.tsx's sibling
    // (`use-gated-apply.ts`); no `setAuthTrigger` here since this surface's
    // `<AuthPopover>` mount below hardcodes `trigger="auto"`.
    const handleOpenPosting = useGatedApply<PublicJob>({
        user,
        gate: (action) => gate(action, { originSurface: "job_detail", gateReason: "apply" }),
        perform: (target) => {
            if (target.apply_url && shouldPromptApplyIntent()) {
                setApplyIntentOpen(true);
                return;
            }
            openPostingNow(target);
        },
    });

    const handleGuestTrackSignIn = () => {
        setAuthGateReason("tracker");
        setAuthTrigger("user");
        recordAuthGateOpen({
            storage: window.sessionStorage,
            reason: "tracker",
            trigger: "user",
            originSurface: "job_detail",
            jobId: job.id,
        });
        gate({ kind: "apply", payload: job }, { originSurface: "job_detail", gateReason: "tracker" });
        setGuestTrackPrompt(null);
    };

    const handleGoAfter = (target: PublicJob) => {
        if (!user) {
            if (guestSaveGateReached()) {
                openAuth("save", "user");
                return;
            }
            addGuestPursuit(target);
            recordGuestSave();
            if (!prefersReducedMotion()) hapticTap("success");
            triggerSavePulse();
            toast.success(GUEST_SAVE_TOAST);
            // A guest's first save is a real save — same placement rule as
            // jobs/page.tsx's handleGoAfter: after the gate branch above (which
            // returns instead of saving), so a rejected click never counts.
            captureEvent("job_saved", {
                job_id: target.id,
                ...matchAnalyticsProps(matchScoreFor(target)),
            });
            return;
        }
        if (saveInFlightRef.current.has(target.id)) return;
        if (pursuitsByJobId.has(target.id)) return;
        const prior = byJobId.get(target.id);
        saveInFlightRef.current.add(target.id);
        setOptimisticPursuits((prev) => {
            const next = new Map(prev);
            next.set(target.id, buildOptimisticPursuit(target));
            return next;
        });
        triggerSavePulse();
        void (async () => {
            try {
                const res = await goAfterJobAction(target);
                if (res.error) {
                    setOptimisticPursuits((prev) => {
                        const next = new Map(prev);
                        if (prior) next.set(target.id, prior);
                        else next.delete(target.id);
                        return next;
                    });
                    if (classifySentinel(res.error) === "auth") {
                        openAuth("save");
                    } else {
                        toast.error(`Could not save: ${res.error}`);
                    }
                    return;
                }
                invalidatePursuitsCache();
                if (!prefersReducedMotion()) hapticTap("success");
                toast.success(GUEST_SAVE_TOAST);
                captureEvent("job_saved", {
                    job_id: target.id,
                    ...matchAnalyticsProps(matchScoreFor(target)),
                });
            } catch (e) {
                setOptimisticPursuits((prev) => {
                    const next = new Map(prev);
                    if (prior) next.set(target.id, prior);
                    else next.delete(target.id);
                    return next;
                });
                if (classifySentinel(e) === "auth") {
                    openAuth("save");
                } else {
                    toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
                }
            } finally {
                saveInFlightRef.current.delete(target.id);
            }
        })();
    };

    const handleOpenRelated = (jobId: string, relatedJob?: PublicJob) => {
        if (onOpenRelated) {
            onOpenRelated(jobId, relatedJob);
        } else {
            router.push(`/jobs?job=${encodeURIComponent(jobId)}`);
        }
    };

    return (
        <>
            <ApplyIntentDialog
                job={job}
                open={applyIntentOpen}
                onOpenChange={setApplyIntentOpen}
                onContinue={() => {
                    if (user) armApplyReturnJob(job);
                }}
            />
            <AuthPopover
                open={authOpen}
                onOpenChange={setAuthOpen}
                onAuthed={onAuthed}
                showTrigger={false}
                trigger={authTrigger}
                originSurface="job_detail"
                jobId={job.id}
                signedIn={Boolean(user)}
                valueLine={
                    authGateReason
                        ? formatAuthGateValueLine(authGateReason, listGuestPursuits().length)
                        : undefined
                }
                defaultTab={authGateReason === "tracker" ? "signup" : "login"}
                reason={authGateReason ?? undefined}
            />
            {layout === "document" ? (
                <JobDetailDocument
                    job={job}
                    now={nowMs}
                    source={effectiveSource}
                    signedIn={Boolean(user)}
                    pursuit={pursuitsByJobId.get(job.id)}
                    saveSuccessPulse={savePulse}
                    reportJobEnabled={reportJobEnabled}
                    onOpenPosting={() => handleOpenPosting(job)}
                    onGoAfter={() => handleGoAfter(job)}
                    matchScore={matchScore}
                    matchAsOfDate={resumeAsOfDate}
                    matchPending={matchPending}
                    resume={resume}
                    onUploadResume={() => router.push("/resume")}
                    onSignInToSync={() => openAuth("tailor", "user")}
                />
            ) : (
                <>
                    {/* The panel layout lives in the company page's role sheet, where
                        the floating prompt is hidden (see ApplyReturnPrompt), so the
                        question sits at the top of the sheet the visitor returns to. */}
                    {applyReturnPrompt && (
                        <div className="px-4 pt-3">
                            <ApplyReturnPrompt
                                placement="inline"
                                record={applyReturnPrompt}
                                onMarkApplied={markApplyReturnApplied}
                                onDismiss={dismissApplyReturn}
                            />
                        </div>
                    )}
                    <JobDetail
                        job={job}
                        now={nowMs}
                        source={effectiveSource}
                        signedIn={Boolean(user)}
                        pursuit={pursuitsByJobId.get(job.id)}
                        saveSuccessPulse={savePulse}
                        reportJobEnabled={reportJobEnabled}
                        onClose={onClose}
                        onOpenRelated={handleOpenRelated}
                        collapseDescription={collapseDescription}
                        className={cn(detailClassName)}
                        onOpenPosting={() => handleOpenPosting(job)}
                        onGoAfter={() => handleGoAfter(job)}
                        matchScore={matchScore}
                        matchAsOfDate={resumeAsOfDate}
                        matchPending={matchPending}
                        resume={resume}
                        onUploadResume={() => router.push("/resume")}
                        onSignInToSync={() => openAuth("tailor", "user")}
                    />
                </>
            )}
            {/* Document layout already has its own sticky-rail Apply card at
                lg+ (JobDetailDocument's `applyCardEl`) AND, below `lg`, its
                own in-stack sticky `JobDetailActionBar` (rulebook "sticky
                mobile action bar", stacked above the sitewide MobileTabBar) —
                a second mount here would double it up in the DOM. Only the
                panel layout (the SERP glass panel, which owns no action bar
                of its own at any width) needs this bar; unconditional,
                exactly as before. */}
            {layout !== "document" && (
                <JobDetailActionBar
                    job={job}
                    signedIn={Boolean(user)}
                    onOpenPosting={() => handleOpenPosting(job)}
                    onGoAfter={() => handleGoAfter(job)}
                    pursuit={pursuitsByJobId.get(job.id)}
                    saveSuccessPulse={savePulse}
                />
            )}
            <GuestApplyTrackPrompt
                record={guestTrackPrompt}
                onSignIn={handleGuestTrackSignIn}
                onDismiss={() => setGuestTrackPrompt(null)}
            />
            {layout === "document" && (
                <ApplyReturnPrompt
                    record={applyReturnPrompt}
                    onMarkApplied={markApplyReturnApplied}
                    onDismiss={dismissApplyReturn}
                />
            )}
        </>
    );
}
