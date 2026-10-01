"use client";

import { useEffect, useState } from "react";
import { FlagIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { jobActionSize } from "@/lib/jobs/toolbar-control-height";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Affordance } from "@/components/jobs/SerpFilters";
import { reportJobAction, type ReportJobReason } from "@/actions/report-job";
import { cn } from "@/lib/utils";

/**
 * ITEM O-FE (2026-08-15, Vivek-approved) — one component, two mounts
 * (`JobDetail`'s action row, `JobDetailDocument`'s pass-through, both via
 * `PublicJobDetail` or `jobs/page.tsx`). No account is needed to report
 * (2026-09-28): the trigger opens the dialog directly and `reportJobAction`
 * rate-limits and keys the write server-side.
 */

const REASON_OPTIONS: { value: ReportJobReason; label: string }[] = [
    { value: "dead_link", label: "Dead link / can't apply" },
    { value: "filled", label: "Position filled or closed" },
    { value: "misleading", label: "Details are wrong (pay, location, title)" },
    { value: "ghost_job", label: "They're not really hiring" },
    { value: "spam", label: "Spam / not a real job" },
    { value: "other", label: "Something else" },
];

type Phase = "form" | "submitting" | "done";

export function ReportJobButton({
    jobId,
    jobUrl,
    jobTitle,
    className,
}: {
    /** Lets a "link is dead" or "filled" report put the listing at the front
     *  of Subspace's liveness checks (see liveness-demand.ts). */
    jobId?: string;
    jobUrl: string;
    jobTitle: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState<ReportJobReason>("dead_link");
    const [notes, setNotes] = useState("");
    const [phase, setPhase] = useState<Phase>("form");
    // Calm-state copy for the in-dialog result (success, already-reported,
    // rate-limited) — one line, no error styling for the non-error cases.
    const [resultText, setResultText] = useState<string | null>(null);
    const [resultIsError, setResultIsError] = useState(false);
    // Local only (spec): flips the trigger to a disabled "Reported ✓" for
    // this job in this session — not persisted, not the same field as the
    // corpus-backed `report_count` chip (ITEM Q) other jobs may carry.
    const [reported, setReported] = useState(false);

    // Fresh form state every time the dialog opens. Kept ABOVE the `reported` early return below (Rules of Hooks —
    // every hook here must run on every render, including the ones that
    // return the "Reported ✓" pill instead of the dialog).
    useEffect(() => {
        if (!open) return;
        setPhase("form");
        setResultText(null);
        setResultIsError(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (reported) {
        return (
            <span
                data-testid="report-job-done"
                className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
            >
                <FlagIcon weight="fill" />
                Reported ✓
            </span>
        );
    }

    const submit = async () => {
        setPhase("submitting");
        const result = await reportJobAction({ jobId, jobUrl, jobTitle, reason, notes });
        switch (result.kind) {
            case "ok":
                setPhase("done");
                setResultText("Thanks — we'll take a look.");
                setReported(true);
                break;
            case "already_reported":
                setPhase("done");
                setResultText("You've already reported this.");
                setReported(true);
                break;
            case "rate_limited":
                setPhase("done");
                setResultText("Try again later.");
                break;
            case "error":
                setPhase("form");
                setResultText(result.message);
                setResultIsError(true);
                break;
        }
    };

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size={jobActionSize}
                onClick={() => setOpen(true)}
                data-testid="report-job-trigger"
                className={cn("gap-1.5 text-muted-foreground", className)}
            >
                <FlagIcon />
                Report listing
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent data-testid="report-job-dialog" className="sm:max-w-[420px]">
                    <DialogTitle>Report this listing</DialogTitle>
                    <DialogDescription>Tell us what&apos;s wrong — we review every report.</DialogDescription>
                    {phase === "done" ? (
                        <p className="py-2 text-sm text-foreground">{resultText}</p>
                    ) : (
                        <>
                            <div className="flex flex-col gap-1">
                                {REASON_OPTIONS.map((o) => (
                                    <Affordance key={o.value} inputType="radio" active={reason === o.value} onClick={() => setReason(o.value)}>
                                        {o.label}
                                    </Affordance>
                                ))}
                            </div>
                            <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Anything else we should know? (optional)"
                                rows={2}
                            />
                            {resultText && (
                                <p className={cn("text-sm", resultIsError ? "text-destructive" : "text-muted-foreground")}>{resultText}</p>
                            )}
                            <DialogFooter>
                                <Button onClick={submit} disabled={phase === "submitting"} data-testid="report-job-submit">
                                    {phase === "submitting" ? "Sending…" : "Submit report"}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
