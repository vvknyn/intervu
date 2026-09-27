"use client";

import type { PublicJob } from "@/lib/jobs/types";
import { decodeText } from "@/lib/jobs/presentation";

export const GUEST_APPLY_TRACK_COPY = "Track this application in Velai — sign in.";

export interface GuestApplyTrackRecord {
    jobId: string;
    title: string;
}

export function GuestApplyTrackPrompt({
    record,
    onSignIn,
    onDismiss,
}: {
    record: GuestApplyTrackRecord | null;
    onSignIn: () => void;
    onDismiss: () => void;
}) {
    if (!record) return null;
    return (
        <div
            data-testid="guest-apply-track-prompt"
            role="status"
            className="fixed right-4 z-40 flex w-full max-w-sm items-start gap-3 border border-border bg-surface px-4 py-3 bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px)+1rem)] lg:bottom-24"
        >
            <div className="min-w-0 flex-1">
                <div className="truncate text-meta text-foreground">{decodeText(record.title)}</div>
                <button
                    type="button"
                    data-testid="guest-apply-track-sign-in"
                    onClick={onSignIn}
                    className="mt-1 text-left text-sm font-semibold text-brand hover:underline"
                >
                    {GUEST_APPLY_TRACK_COPY}
                </button>
            </div>
            <button
                type="button"
                data-testid="guest-apply-track-dismiss"
                onClick={onDismiss}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
                Dismiss
            </button>
        </div>
    );
}
