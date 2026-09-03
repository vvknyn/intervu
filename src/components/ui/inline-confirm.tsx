"use client";

/**
 * Shared two-step inline confirm — the bordered "{prompt}?" box with a
 * destructive Confirm + outline Cancel that appeared identically (near
 * byte-for-byte) in `YourResumeSection.tsx`'s `manageRow`. Extracted here
 * rather than letting a second hand-rolled copy land in
 * `PursuitDetailSheet.tsx`'s Remove flow — one shape, one place it can drift.
 */

import { CircleNotch, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface InlineConfirmProps {
    prompt: string;
    confirmLabel?: string;
    busyLabel?: string;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    className?: string;
}

export function InlineConfirm({
    prompt,
    confirmLabel = "Confirm",
    busyLabel = "Working…",
    busy,
    onConfirm,
    onCancel,
    className,
}: InlineConfirmProps) {
    return (
        <div
            className={cn(
                "flex w-full flex-col gap-2 rounded-none border border-border bg-muted p-3 sm:w-auto sm:flex-row sm:items-center",
                className,
            )}
        >
            <span className="text-xs text-muted-foreground">{prompt}</span>
            <div className="flex w-full gap-2 sm:w-auto">
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={onConfirm}
                    className="w-full gap-1.5 rounded-none sm:w-auto"
                >
                    {busy ? <CircleNotch className="animate-spin" /> : <Trash />}
                    {busy ? busyLabel : confirmLabel}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onCancel}
                    disabled={busy}
                    className="w-full rounded-none sm:w-auto"
                >
                    Cancel
                </Button>
            </div>
        </div>
    );
}
