"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { goAfterJobAction } from "@/actions/application";
import { reportJobEnabledAction } from "@/actions/report-job";
import { JobDetail } from "@/components/jobs/JobDetail";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { resolveApplyGateDecision } from "@/lib/jobs/pending-actions";
import { shouldPromptApplyIntent } from "@/lib/jobs/apply-intent";
import { ApplyIntentDialog } from "@/components/jobs/ApplyIntentDialog";
import { decodeText, locationText } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { toast } from "@/lib/toast";

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
    const pathname = usePathname();
    const router = useRouter();

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
            job={{
                id: job.id,
                title: decodeText(job.title),
                company: job.company || "Unknown company",
                location: locationText(job) || null,
            }}
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
            signedIn
            pursuit={undefined}
            goingAfter={goingAfter}
            reportJobEnabled={reportJobEnabled}
            onClose={onClose}
            onOpenRelated={handleOpenRelated}
            onRequestSignIn={requireAuth}
            onOpenPosting={() => {
                if (!job.apply_url) return;
                // Second entry point into the same departure. /jobs' own
                // handler gates here too; this one has to as well or the
                // prompt silently depends on which surface you applied from.
                if (shouldPromptApplyIntent()) {
                    setApplyIntentOpen(true);
                    return;
                }
                window.open(job.apply_url, "_blank", "noopener,noreferrer");
            }}
            onGoAfter={() => {
                if (resolveApplyGateDecision(Boolean(getCurrentUser())) === "gate") {
                    requireAuth();
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
                        toast.success("Saved — find it in your Tracker");
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
