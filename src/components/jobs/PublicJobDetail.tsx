"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { goAfterJobAction } from "@/actions/application";
import { markJobAppliedAction } from "@/actions/jobs";
import { reportJobEnabledAction } from "@/actions/report-job";
import { AuthPopover } from "@/components/auth/auth-popover";
import { useAuthGate } from "@/components/auth/use-auth-gate";
import { ApplyIntentDialog } from "@/components/jobs/ApplyIntentDialog";
import { ApplyReturnPrompt, useApplyReturnPrompt, type ApplyReturnJob } from "@/components/jobs/ApplyReturnPrompt";
import { fetchResumeData } from "@/actions/resume";
import { JobDetail, JobDetailActionBar } from "@/components/jobs/JobDetail";
import { JobDetailDocument } from "@/components/jobs/JobDetailDocument";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import {
    formatAuthGateValueLine,
    GUEST_SAVE_TOAST,
    type AuthGateReason,
} from "@/lib/auth/auth-gate-copy";
import { getGuestSaveCount, recordGuestSave } from "@/lib/auth/guest-save-gate";
import { shouldPromptApplyIntent } from "@/lib/jobs/apply-intent";
import { shortDate } from "@/lib/jobs/presentation";
import { resolveApplyGateDecision } from "@/lib/jobs/pending-actions";
import type { PublicJob } from "@/lib/jobs/types";
import { captureEvent, type EventSource } from "@/lib/analytics/events";
import { classifySentinel } from "@/lib/llm/sentinels";
import { scoreJobAgainstResume } from "@/lib/match/score";
import { addGuestPursuit, listGuestPursuits } from "@/lib/pursuits/guest-store";
import { hasReachedStage } from "@/lib/pursuits/types";
import { invalidatePursuitsCache, usePursuits } from "@/lib/pursuits/use-pursuits";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
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
    const [goingAfter, setGoingAfter] = useState(false);
    const [applyIntentOpen, setApplyIntentOpen] = useState(false);
    const [user, setUser] = useState<User | null>(() => getCurrentUser());
    const [authGateReason, setAuthGateReason] = useState<AuthGateReason | null>(null);
    // Controls the report dialog from outside `ReportJobButton` so a
    // post-auth replay (see `useAuthGate` below) can reopen the exact
    // dialog the user was filling out before sign-in.
    const [reportDialogOpen, setReportDialogOpen] = useState(false);
    const router = useRouter();
    const { byJobId } = usePursuits();

    useEffect(() => onAuthChange(setUser), []);

    // Same résumé read path `/jobs` uses (`fetchResumeData` →
    // `resume_last_updated`, see actions/resume.ts) so the detail-header chip
    // can never disagree with the SERP card chip for the same signed-in user.
    const [resume, setResume] = useState<ResumeData | null>(null);
    const [resumeAsOfDate, setResumeAsOfDate] = useState<string | null>(null);
    useEffect(() => {
        if (!user) {
            setResume(null);
            setResumeAsOfDate(null);
            return;
        }
        let cancelled = false;
        fetchResumeData()
            .then(({ data, updatedAt }) => {
                if (cancelled || !data || !resumeIsUsable(data)) return;
                setResume(data);
                const ms = updatedAt ? Date.parse(updatedAt) : NaN;
                setResumeAsOfDate(Number.isFinite(ms) ? shortDate(ms).toLowerCase() : null);
            })
            .catch(() => {
                /* no résumé on file — no chip, no nagging */
            });
        return () => {
            cancelled = true;
        };
    }, [user]);
    const matchScore = resume ? scoreJobAgainstResume(resume, job) : null;

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
    // `apply`/`gate` reference `doMarkApplied`/`replayApplyGate`, declared
    // later in this component — safe because these are arrow functions, not
    // calls: the reference resolves only when the auth gate invokes them,
    // long after this component has finished its first render.
    const { gate, authOpen, setAuthOpen, onAuthed } = useAuthGate<PublicJob, PublicJob>({
        handlers: {
            apply: (action) => void doMarkApplied(action.payload),
            gate: (action) => void replayApplyGate(action.payload),
            // This surface has no résumé importer — nothing here ever calls
            // `gate({ kind: "upload", ... })`, so this is unreachable. Still
            // required: `AuthGateHandlers` is a mapped type over every
            // `PendingAction` kind, so every caller supplies all four.
            upload: () => {},
            // Single-job page: only reopen the dialog when the persisted
            // report actually belongs to THIS job — a stale or foreign
            // record must never pop the dialog for whatever job this route
            // happens to be showing.
            report: (action) => {
                if (action.payload?.id === job.id) setReportDialogOpen(true);
            },
        },
        user,
    });

    const openAuth = (reason: AuthGateReason | null = null) => {
        setAuthGateReason(reason);
        setAuthOpen(true);
    };

    const openPostingNow = (target: PublicJob) => {
        if (!target.apply_url) return;
        // A1 — arms the shared "did you apply?" return prompt (see
        // ApplyReturnPrompt.tsx) the same way jobs/page.tsx's own
        // `openPostingNow` does, for this standalone `/jobs/[slug]` and `/co`
        // panel surface.
        armApplyReturnJob(target);
        window.open(target.apply_url, "_blank", "noopener,noreferrer");
    };

    const doMarkApplied = async (target: ApplyReturnJob) => {
        try {
            const res = await markJobAppliedAction({
                company: target.company ?? "",
                title: target.title,
                applyUrl: target.apply_url,
                jobId: target.id,
            });
            if (res.error) {
                if (classifySentinel(res.error) === "auth") {
                    openAuth("apply");
                } else {
                    toast.error(`Could not save: ${res.error}`);
                }
                return;
            }
            invalidatePursuitsCache();
            captureEvent("job_marked_applied", { job_id: target.id });
            toast.success("Marked as applied");
        } catch (e) {
            if (classifySentinel(e) === "auth") {
                openAuth("apply");
            } else {
                toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    };

    // A1 — shared hook (see jobs/page.tsx's own mount for the sibling
    // comment): this surface's "already applied" is the same
    // `byJobId`/`hasReachedStage` pursuit check, and marking applied from
    // the prompt reuses `doMarkApplied` above rather than a second write path.
    const { prompt: applyReturnPrompt, arm: armApplyReturnJob, markApplied: markApplyReturnApplied, dismiss: dismissApplyReturn } =
        useApplyReturnPrompt({
            isAlreadyApplied: (jobId) => {
                const pursuit = byJobId.get(jobId);
                return !!pursuit && hasReachedStage(pursuit, "applied");
            },
            onMarkApplied: doMarkApplied,
        });

    const replayApplyGate = async (target: PublicJob) => {
        await doMarkApplied(target);
        if (target.apply_url) window.location.href = target.apply_url;
    };

    const handleApplyGate = (target: PublicJob) => {
        setAuthGateReason("apply");
        gate({ kind: "gate", payload: target });
    };

    const handleOpenPosting = (target: PublicJob) => {
        if (resolveApplyGateDecision(Boolean(user)) === "gate") {
            handleApplyGate(target);
            return;
        }
        if (target.apply_url && shouldPromptApplyIntent()) {
            setApplyIntentOpen(true);
            return;
        }
        openPostingNow(target);
    };

    const handleGoAfter = (target: PublicJob) => {
        if (!user) {
            if (getGuestSaveCount() >= 1) {
                openAuth("save");
                return;
            }
            addGuestPursuit(target);
            recordGuestSave();
            toast.success(GUEST_SAVE_TOAST);
            // A guest's first save is a real save — same placement rule as
            // jobs/page.tsx's handleGoAfter: after the gate branch above (which
            // returns instead of saving), so a rejected click never counts.
            captureEvent("job_saved", { job_id: target.id });
            return;
        }
        void (async () => {
            setGoingAfter(true);
            try {
                const res = await goAfterJobAction(target);
                if (res.error) {
                    if (classifySentinel(res.error) === "auth") {
                        openAuth("save");
                    } else {
                        toast.error(`Could not save: ${res.error}`);
                    }
                    return;
                }
                invalidatePursuitsCache();
                toast.success(GUEST_SAVE_TOAST);
                captureEvent("job_saved", { job_id: target.id });
            } catch (e) {
                if (classifySentinel(e) === "auth") {
                    openAuth("save");
                } else {
                    toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
                }
            } finally {
                setGoingAfter(false);
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

    // The only `onRequestSignIn` consumer on this surface is `ReportJobButton`
    // (both `JobDetail`/`JobDetailDocument` reserve that prop for it) — route
    // it through the report gate so a signed-out report reopens this exact
    // dialog once the user is back, same as Apply.
    const requireReportAuth = () => {
        setAuthGateReason("generic");
        gate({ kind: "report", payload: job });
    };

    return (
        <>
            <ApplyIntentDialog
                job={job}
                open={applyIntentOpen}
                onOpenChange={setApplyIntentOpen}
                onContinue={() => openPostingNow(job)}
            />
            <AuthPopover
                open={authOpen}
                onOpenChange={setAuthOpen}
                onAuthed={onAuthed}
                showTrigger={false}
                valueLine={
                    authGateReason
                        ? formatAuthGateValueLine(authGateReason, listGuestPursuits().length)
                        : undefined
                }
                defaultTab={authGateReason === "apply" ? "signup" : "login"}
            />
            {layout === "document" ? (
                <JobDetailDocument
                    job={job}
                    now={nowMs}
                    source={effectiveSource}
                    signedIn={Boolean(user)}
                    pursuit={byJobId.get(job.id)}
                    goingAfter={goingAfter}
                    reportJobEnabled={reportJobEnabled}
                    reportDialogOpen={reportDialogOpen}
                    onReportDialogOpenChange={setReportDialogOpen}
                    onOpenRelated={handleOpenRelated}
                    onRequestSignIn={requireReportAuth}
                    onOpenPosting={() => handleOpenPosting(job)}
                    onGoAfter={() => handleGoAfter(job)}
                    matchScore={matchScore}
                    matchAsOfDate={resumeAsOfDate}
                />
            ) : (
                <JobDetail
                    job={job}
                    now={nowMs}
                    source={effectiveSource}
                    signedIn={Boolean(user)}
                    pursuit={byJobId.get(job.id)}
                    goingAfter={goingAfter}
                    reportJobEnabled={reportJobEnabled}
                    reportDialogOpen={reportDialogOpen}
                    onReportDialogOpenChange={setReportDialogOpen}
                    onClose={onClose}
                    onOpenRelated={handleOpenRelated}
                    onRequestSignIn={requireReportAuth}
                    collapseDescription={collapseDescription}
                    className={cn(detailClassName)}
                    onOpenPosting={() => handleOpenPosting(job)}
                    onGoAfter={() => handleGoAfter(job)}
                    matchScore={matchScore}
                    matchAsOfDate={resumeAsOfDate}
                />
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
                    pursuit={byJobId.get(job.id)}
                    goingAfter={goingAfter}
                />
            )}
            <ApplyReturnPrompt
                record={applyReturnPrompt}
                onMarkApplied={markApplyReturnApplied}
                onDismiss={dismissApplyReturn}
            />
        </>
    );
}
