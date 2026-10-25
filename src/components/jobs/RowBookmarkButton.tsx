"use client";

import { useState } from "react";
import Link from "next/link";
import { BookmarkSimple } from "@phosphor-icons/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { jobActionIconSize } from "@/lib/jobs/toolbar-control-height";
import { cn } from "@/lib/utils";
import type { Pursuit } from "@/lib/pursuits/types";
import { isOptimisticPursuitId } from "@/lib/pursuits/optimistic-pursuit";

/**
 * Icon-only ghost bookmark on the job-action step (GROUP-C row anatomy — list rows
 * and the detail action row/mobile action bar all read the same
 * pursuit/onGoAfter contract). Klein-filled glyph linking to the saved record
 * when `pursuit` exists; muted outline glyph + `onGoAfter` otherwise.
 * In-flight save is reflected via optimistic pursuit overlay, not a spinner.
 */
export function RowBookmarkButton({
    pursuit,
    onGoAfter,
    successPulse = false,
    className,
}: {
    pursuit: Pursuit | undefined;
    onGoAfter: () => void;
    successPulse?: boolean;
    className?: string;
}) {
    // The state words for assistive tech, spoken only when the state CHANGES
    // while this button is mounted (a list of already-saved rows stays silent).
    // A toast would be visual noise on every save, so there is no toast: the
    // existing toaster is for errors and the guest sign-in prompt.
    const saved = pursuit !== undefined;
    const [last, setLast] = useState({ saved, message: "" });
    if (last.saved !== saved) setLast({ saved, message: saved ? "Saved" : "Removed" });
    return (
        <>
            <BookmarkControl
                pursuit={pursuit}
                onGoAfter={onGoAfter}
                successPulse={successPulse}
                changed={last.message}
                className={className}
            />
            <span role="status" aria-live="polite" className="sr-only">
                {last.message}
            </span>
        </>
    );
}

function BookmarkControl({
    pursuit,
    onGoAfter,
    successPulse,
    changed,
    className,
}: {
    pursuit: Pursuit | undefined;
    onGoAfter: () => void;
    successPulse: boolean;
    /** "Saved" / "Removed" once the state has flipped since mount, else "". */
    changed: string;
    className?: string;
}) {
    if (pursuit) {
        const optimistic = isOptimisticPursuitId(pursuit.id);
        // The glyph eases in on the flip. Only the first element after it does: the optimistic → confirmed swap keeps the filled glyph, so replaying the fade there would blink.
        const filled = (
            <BookmarkSimple
                size={20}
                weight="fill"
                className={cn(successPulse && "success-pulse", optimistic && changed === "Saved" && "fade-in-base")}
            />
        );
        if (optimistic) {
            return (
                <Button
                    variant="ghost"
                    size={jobActionIconSize}
                    type="button"
                    disabled
                    aria-label="Saved"
                    title="Saved"
                    data-testid="job-save-optimistic"
                    className={cn("text-foreground", className)}
                >
                    {filled}
                </Button>
            );
        }
        return (
            <Link
                href={`/yours/${pursuit.id}`}
                aria-label="Saved — view in Yours"
                title="Saved"
                data-testid="job-save-confirmed"
                className={buttonVariants({
                    variant: "ghost",
                    size: jobActionIconSize,
                    className: cn("text-foreground", successPulse && "success-pulse", className),
                })}
            >
                <BookmarkSimple size={20} weight="fill" />
            </Link>
        );
    }
    return (
        <Button
            variant="ghost"
            size={jobActionIconSize}
            onClick={onGoAfter}
            aria-label="Save this job"
            title="Save"
            data-testid="job-save-trigger"
            className={cn("text-muted-foreground hover:text-foreground", successPulse && "success-pulse", className)}
        >
            <BookmarkSimple size={20} className={cn(changed === "Removed" && "fade-in-base")} />
        </Button>
    );
}
