"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { goAfterJobAction } from "@/actions/application";
import { markJobAppliedAction } from "@/actions/jobs";
import { reportJobEnabledAction } from "@/actions/report-job";
import { AuthPopover } from "@/components/auth/auth-popover";
import { ApplyIntentDialog } from "@/components/jobs/ApplyIntentDialog";
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
import {
    emptyPending,
    queuePending,
    resolveApplyGateDecision,
    takeReplay,
    type PendingState,
} from "@/lib/jobs/pending-actions";
import type { PublicJob } from "@/lib/jobs/types";
import { classifySentinel } from "@/lib/llm/sentinels";
import { addGuestPursuit, listGuestPursuits } from "@/lib/pursuits/guest-store";
import { invalidatePursuitsCache, usePursuits } from "@/lib/pursuits/use-pursuits";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

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
}: PublicJobDetailProps) {
    const [nowMs] = useState(() => Date.now());
    const [goingAfter, setGoingAfter] = useState(false);
    const [applyIntentOpen, setApplyIntentOpen] = useState(false);
    const [user, setUser] = useState<User | null>(() => getCurrentUser());
    const [authOpen, setAuthOpen] = useState(false);
    const [authGateReason, setAuthGateReason] = useState<AuthGateReason | null>(null);
    const router = useRouter();
    const { byJobId } = usePursuits();
    const authedRef = useRef(false);
    const pendingRef = useRef<PendingState<PublicJob, PublicJob>>(emptyPending());

    useEffect(() => onAuthChange(setUser), []);

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

    const openAuth = (reason: AuthGateReason | null = null) => {
        authedRef.current = false;
        setAuthGateReason(reason);
        setAuthOpen(true);
    };

    const openPostingNow = (target: PublicJob) => {
        if (!target.apply_url) return;
        window.open(target.apply_url, "_blank", "noopener,noreferrer");
    };

    const doMarkApplied = async (target: PublicJob) => {
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
        } catch (e) {
            if (classifySentinel(e) === "auth") {
                openAuth("apply");
            } else {
                toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    };

    const replayApplyGate = async (target: PublicJob) => {
        await doMarkApplied(target);
        if (target.apply_url) window.location.href = target.apply_url;
    };

    const maybeReplay = useCallback(() => {
        if (!authedRef.current) return;
        const { next, action } = takeReplay(pendingRef.current);
        pendingRef.current = next;
        if (!action) return;
        switch (action.kind) {
            case "gate":
                void replayApplyGate(action.payload);
                break;
            default:
                break;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleAuthed = () => {
        authedRef.current = true;
        maybeReplay();
    };

    useEffect(() => {
        if (user) maybeReplay();
    }, [user, maybeReplay]);

    const handleApplyGate = (target: PublicJob) => {
        pendingRef.current = queuePending(pendingRef.current, { kind: "gate", payload: target });
        openAuth("apply");
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

    const requireAuth = () => {
        openAuth("generic");
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
                onAuthed={handleAuthed}
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
                    signedIn={Boolean(user)}
                    pursuit={byJobId.get(job.id)}
                    goingAfter={goingAfter}
                    reportJobEnabled={reportJobEnabled}
                    onOpenRelated={handleOpenRelated}
                    onRequestSignIn={requireAuth}
                    onOpenPosting={() => handleOpenPosting(job)}
                    onGoAfter={() => handleGoAfter(job)}
                />
            ) : (
                <JobDetail
                    job={job}
                    now={nowMs}
                    signedIn={Boolean(user)}
                    pursuit={byJobId.get(job.id)}
                    goingAfter={goingAfter}
                    reportJobEnabled={reportJobEnabled}
                    onClose={onClose}
                    onOpenRelated={handleOpenRelated}
                    onRequestSignIn={requireAuth}
                    collapseDescription={collapseDescription}
                    className={cn(detailClassName)}
                    onOpenPosting={() => handleOpenPosting(job)}
                    onGoAfter={() => handleGoAfter(job)}
                />
            )}
            {/* Document layout already has its own sticky-rail Apply card at
                lg+ (JobDetailDocument's `applyCardEl`) — this bar stacking on
                top of it would be a redundant second Apply CTA that, at full
                document width, sits on top of the (now unclamped) description
                text instead of a short clamped panel. Mobile still needs it:
                the document layout's single-column stack has no persistent
                rail there. The panel layout is unchanged — unconditional,
                exactly as before. */}
            {layout === "document" ? (
                <div className="lg:hidden">
                    <JobDetailActionBar
                        job={job}
                        signedIn={Boolean(user)}
                        onOpenPosting={() => handleOpenPosting(job)}
                    />
                </div>
            ) : (
                <JobDetailActionBar
                    job={job}
                    signedIn={Boolean(user)}
                    onOpenPosting={() => handleOpenPosting(job)}
                />
            )}
        </>
    );
}
