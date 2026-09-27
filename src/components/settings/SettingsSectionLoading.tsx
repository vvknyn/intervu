import { useId } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** Labeled loading row for settings cards (P1-8 — not bare "Loading…"). */
export function SettingsSectionLoading({ label, className }: { label: string; className?: string }) {
    const labelId = useId();
    return (
        <div
            className={cn("flex items-center gap-2 py-2 text-sm text-muted-foreground", className)}
            role="status"
            aria-busy="true"
            aria-labelledby={labelId}
        >
            <CircleNotch size={16} className="animate-spin shrink-0" aria-hidden />
            <span id={labelId}>{label}</span>
        </div>
    );
}
