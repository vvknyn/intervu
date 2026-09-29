"use client";

import {  } from "@phosphor-icons/react";
import { InlineSpinner } from "@/components/ui/wait-state";

/** Minimal in-route wait — spinner only, no branded splash. */
export function RouteSuspenseFallback({ label = "Loading…" }: { label?: string }) {
    return (
        <div className="flex min-h-[40vh] items-center justify-center bg-background" role="status" aria-busy="true">
            <span className="sr-only">{label}</span>
            <InlineSpinner size={24} className="text-muted-foreground" />
        </div>
    );
}
