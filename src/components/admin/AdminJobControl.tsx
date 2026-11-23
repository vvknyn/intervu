"use client";

import { useEffect, useState } from "react";
import { ProhibitInsetIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Affordance } from "@/components/jobs/SerpFilters";
import { jobActionSize } from "@/lib/jobs/toolbar-control-height";
import { settleAction } from "@/lib/load-result";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import { cn } from "@/lib/utils";
import { adminModerationAvailableAction, removeListingAction } from "@/actions/admin-moderation";
import { LISTING_REASON_OPTIONS, NOTE_MAX, type ListingReason } from "@/lib/admin/moderation";

/**
 * Admin-only "Remove listing" on a job page: the same listing is closed and
 * hidden by Subspace, so it leaves search and a later scan cannot bring it
 * back. Soft: /admin → Recent actions has the undo.
 *
 * Renders NOTHING for anyone who is not an admin, and costs a signed-out
 * visitor nothing: the availability question is asked of the server only once a
 * client-side sign-in exists, and once per page load. The server action
 * re-checks admin on every call, so this probe is a courtesy, never the gate.
 */

// One answer per page load, shared by every mount (the list and the detail pane can both mount this).
let availability: Promise<boolean> | null = null;
function adminControlsAvailable(): Promise<boolean> {
    availability ??= settleAction(adminModerationAvailableAction()).then((r) => r === true);
    return availability;
}

type Phase = "form" | "submitting" | "done";

export function AdminJobControl({ jobId, jobTitle, className }: { jobId: string; jobTitle: string; className?: string }) {
    const [signedIn, setSignedIn] = useState(() => getCurrentUser() !== null);
    const [available, setAvailable] = useState(false);
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState<ListingReason>("not_a_job");
    const [note, setNote] = useState("");
    const [phase, setPhase] = useState<Phase>("form");
    const [message, setMessage] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [removed, setRemoved] = useState(false);

    useEffect(
        () =>
            onAuthChange((user) => {
                // A different person may sign in next on this page load: ask again for them.
                if (!user) availability = null;
                setSignedIn(user !== null);
            }),
        [],
    );

    useEffect(() => {
        if (!signedIn) return;
        let live = true;
        void adminControlsAvailable().then((ok) => live && setAvailable(ok));
        return () => {
            live = false;
        };
    }, [signedIn]);

    // `available` is only ever set once someone is signed in; signing out hides the control without a state write.
    if (!signedIn || !available) return null;

    if (removed) {
        return (
            <span data-testid="admin-remove-listing-done" className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
                <ProhibitInsetIcon weight="fill" />
                Removed ✓
            </span>
        );
    }

    // A fresh form every time the dialog opens, set where it opens rather than in an effect.
    const openDialog = () => {
        setPhase("form");
        setMessage(null);
        setFailed(false);
        setOpen(true);
    };

    const submit = async () => {
        setPhase("submitting");
        const settled = await settleAction(removeListingAction({ jobId, reason, note }));
        if ("error" in settled) {
            setPhase("form");
            setFailed(true);
            setMessage(String(settled.error));
            return;
        }
        switch (settled.kind) {
            case "ok":
                setPhase("done");
                setRemoved(true);
                setMessage(settled.data.already_removed ? "It was already removed." : "Removed. It leaves search within a few minutes.");
                break;
            case "forbidden":
                setPhase("form");
                setFailed(true);
                setMessage("Your account isn't an admin.");
                break;
            case "unavailable":
                setPhase("form");
                setFailed(true);
                setMessage("Admin moderation isn't configured on this server.");
                break;
            case "error":
                setPhase("form");
                setFailed(true);
                setMessage(settled.message);
                break;
        }
    };

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size={jobActionSize}
                onClick={() => openDialog()}
                data-testid="admin-remove-listing-trigger"
                className={cn("gap-1.5 text-muted-foreground", className)}
            >
                <ProhibitInsetIcon />
                Remove listing
            </Button>
            <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : setOpen(false))}>
                <DialogContent data-testid="admin-remove-listing-dialog" className="sm:max-w-[440px]">
                    <DialogTitle>Remove this listing</DialogTitle>
                    <DialogDescription>
                        {jobTitle}. It is closed and hidden everywhere. You can undo it from Admin, Recent actions.
                    </DialogDescription>
                    {phase === "done" ? (
                        <p className="py-2 text-sm text-foreground">{message}</p>
                    ) : (
                        <>
                            <div className="flex flex-col gap-1">
                                {LISTING_REASON_OPTIONS.map((o) => (
                                    <Affordance key={o.value} inputType="radio" active={reason === o.value} onClick={() => setReason(o.value)}>
                                        {o.label}
                                    </Affordance>
                                ))}
                            </div>
                            <Textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                                placeholder="Note (optional)"
                                rows={2}
                            />
                            {message && <p className={cn("text-sm", failed ? "text-destructive" : "text-muted-foreground")}>{message}</p>}
                            <DialogFooter>
                                <Button onClick={submit} disabled={phase === "submitting"} data-testid="admin-remove-listing-submit">
                                    {phase === "submitting" ? "Removing…" : "Remove listing"}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
