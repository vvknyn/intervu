"use client";

import Link from "next/link";
import { BookmarkSimple, CircleNotch } from "@phosphor-icons/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Pursuit } from "@/lib/pursuits/types";
import { isOptimisticPursuitId } from "@/lib/pursuits/optimistic-pursuit";

/**
 * 40px icon-only ghost bookmark control (GROUP-C row anatomy — list rows
 * and the detail action row/mobile action bar all read the same
 * pursuit/goingAfter/onGoAfter contract). Klein-filled glyph linking to the
 * saved record when `pursuit` exists; muted outline glyph + `onGoAfter`
 * otherwise. `JobDetail`'s main action row, `JobDetailActionBar`, and
 * `JobCard` each built this exact ternary independently before this
 * extraction — consolidated here so a 4th call site can't drift from it.
 */
export function RowBookmarkButton({
    pursuit,
    onGoAfter,
    goingAfter = false,
    successPulse = false,
    className,
}: {
    pursuit: Pursuit | undefined;
    onGoAfter: () => void;
    goingAfter?: boolean;
    successPulse?: boolean;
    className?: string;
}) {
    if (pursuit) {
        const optimistic = isOptimisticPursuitId(pursuit.id);
        const filled = (
            <BookmarkSimple
                size={20}
                weight="fill"
                className={cn(successPulse && "success-pulse")}
            />
        );
        if (optimistic) {
            return (
                <Button
                    variant="ghost"
                    size="icon-lg"
                    type="button"
                    disabled
                    aria-label="Saved"
                    title="Saved"
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
                className={buttonVariants({
                    variant: "ghost",
                    size: "icon-lg",
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
            size="icon-lg"
            onClick={onGoAfter}
            disabled={goingAfter}
            aria-label={goingAfter ? "Saving…" : "Save this job"}
            title={goingAfter ? "Saving…" : "Save"}
            className={cn("text-muted-foreground hover:text-foreground", successPulse && "success-pulse", className)}
        >
            {goingAfter ? <CircleNotch size={20} className="animate-spin" /> : <BookmarkSimple size={20} />}
        </Button>
    );
}
