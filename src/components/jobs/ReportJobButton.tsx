"use client";

import { useState } from "react";
import { FlagIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Affordance } from "@/components/jobs/SerpFilters";
import { resolveApplyGateDecision } from "@/lib/jobs/pending-actions";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { reportJobAction, type ReportJobReason } from "@/actions/report-job";
import { cn } from "@/lib/utils";

/**
 * ITEM O-FE (2026-08-15, Vivek-approved, SIGNED-IN ONLY) — one component,
 * two mounts (`JobDetail`'s action row, `PublicJobDetail`'s pass-through).
 * The gate mirrors the EXISTING apply-adjacent CTA pattern (Apply/Save —
 * see `PublicJobDetail`'s `onOpenPosting`): reads real client auth state
 * with `getCurrentUser()` directly, rather than taking a `signedIn` prop,
 * because `JobDetail`'s own `signedIn` prop is a DIFFERENT concern (guest
 * content-preview truncation) that `PublicJobDetail` hardcodes to `true`
 * for every real visitor — reusing it here would let a real guest on
 * `/jobs/[slug]` skip the gate entirely. `resolveApplyGateDecision` decides
 * signed-out → the caller's own auth gate (`onRequireAuth` — AuthPopover on
 * the board, a `/login` redirect on the standalone job page; each mount
 * already owns one, this does not add a second), signed-in → open the
 * dialog. No queue/replay: unlike Apply, a report isn't something the page
 * needs to finish automatically after a sign-in round-trip — the user
 * reopens the dialog and reports again.
 */

const REASON_OPTIONS: { value: ReportJobReason; label: string }[] = [
    { value: "dead_link", label: "Dead link / can't apply" },
    { value: "filled", label: "Position filled or closed" },
    { value: "misleading", label: "Details are wrong (pay, location, title)" },
    { value: "ghost_job", label: "Looks like a ghost job" },
    { value: "spam", label: "Spam / not a real job" },
    { value: "other", label: "Something else" },
];

type Phase = "form" | "submitting" | "done";

export function ReportJobButton({
    jobUrl,
    jobTitle,
    onRequireAuth,
    className,
}: {
    jobUrl: string;
    jobTitle: string;
    onRequireAuth: () => void;
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

    if (reported) {
        return (
            <span
                data-testid="report-job-done"
                className={cn("inline-flex items-center gap-1.5 text-[12px] text-muted-foreground", className)}
            >
                <FlagIcon size={13} weight="fill" />
                Reported ✓
            </span>
        );
    }

    const handleTrigger = () => {
        if (resolveApplyGateDecision(Boolean(getCurrentUser())) === "gate") {
            onRequireAuth();
            return;
        }
        setPhase("form");
        setResultText(null);
        setResultIsError(false);
        setOpen(true);
    };

    const submit = async () => {
        setPhase("submitting");
        const result = await reportJobAction({ jobUrl, jobTitle, reason, notes });
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
                setResultText("Try again tomorrow.");
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
                size="sm"
                onClick={handleTrigger}
                data-testid="report-job-trigger"
                className={cn("gap-1.5 text-muted-foreground", className)}
            >
                <FlagIcon size={13} />
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
