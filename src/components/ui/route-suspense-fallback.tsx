"use client";

import { CircleNotch } from "@phosphor-icons/react";

/** Minimal in-route wait — spinner only, no branded splash. */
export function RouteSuspenseFallback({ label = "Loading…" }: { label?: string }) {
    return (
        <div className="flex min-h-[40vh] items-center justify-center bg-background" role="status" aria-busy="true">
            <span className="sr-only">{label}</span>
            <CircleNotch size={24} className="animate-spin text-muted-foreground" aria-hidden />
        </div>
    );
}
