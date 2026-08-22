"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { goAfterJobAction } from "@/actions/application";
import { reportJobEnabledAction } from "@/actions/report-job";
import { JobDetail } from "@/components/jobs/JobDetail";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { shouldPromptApplyIntent } from "@/lib/jobs/apply-intent";
import { ApplyIntentDialog } from "@/components/jobs/ApplyIntentDialog";
import type { PublicJob } from "@/lib/jobs/types";
import { toast } from "@/lib/toast";
import { addGuestPursuit } from "@/lib/pursuits/guest-store";
import { usePursuits } from "@/lib/pursuits/use-pursuits";
import { GUEST_SAVE_TOAST } from "@/lib/auth/auth-gate-copy";

export interface PublicJobDetailProps {
    job: PublicJob;
    onClose?: () => void;
    onOpenRelated?: (jobId: string, job?: PublicJob) => void;
}

/**
 * Client-side wiring for `JobDetail` on standalone or modal job views.
 */
export function PublicJobDetail({ job, onClose, onOpenRelated }: PublicJobDetailProps) {
    const [nowMs] = useState(() => Date.now());
    const [goingAfter, setGoingAfter] = useState(false);
    const [applyIntentOpen, setApplyIntentOpen] = useState(false);
    const [user, setUser] = useState<User | null>(() => getCurrentUser());
    const pathname = usePathname();
    const router = useRouter();
    const { byJobId } = usePursuits();

    useEffect(() => onAuthChange(setUser), []);

    const requireAuth = () => {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
    };

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
                if (job.apply_url) {
                    window.open(job.apply_url, "_blank", "noopener,noreferrer");
                }
            }}
        />
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
            onOpenPosting={() => {
                if (!job.apply_url) return;
                if (!user) {
                    requireAuth();
                    return;
                }
                if (shouldPromptApplyIntent()) {
                    setApplyIntentOpen(true);
                    return;
                }
                window.open(job.apply_url, "_blank", "noopener,noreferrer");
            }}
            onGoAfter={() => {
                if (!user) {
                    addGuestPursuit(job);
                    toast.success(GUEST_SAVE_TOAST);
                    return;
                }
                void (async () => {
                    setGoingAfter(true);
                    try {
                        const res = await goAfterJobAction(job);
                        if (res.error) {
                            toast.error(`Could not save: ${res.error}`);
                            return;
                        }
                        toast.success(GUEST_SAVE_TOAST);
                    } catch (e) {
                        toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
                    } finally {
                        setGoingAfter(false);
                    }
                })();
            }}
        />
        </>
    );
}
