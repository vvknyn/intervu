"use client";

import Link from "next/link";
import { chipVariants } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import type { PreferenceChip } from "@/lib/jobs/for-you/preference-chips";

export interface PreferenceChipStripProps {
    chips: PreferenceChip[];
    className?: string;
}

export function PreferenceChipStrip({ chips, className }: PreferenceChipStripProps) {
    return (
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
            <span className="text-xs font-semibold text-muted-foreground">Your preferences</span>
            {chips.map((chip) => (
                <span
                    key={chip.key}
                    className={cn(chipVariants({ active: false }), "h-7 px-2.5 text-xs")}
                >
                    {chip.label}
                </span>
            ))}
            <Link
                href="/settings"
                className="inline-flex min-h-11 items-center text-xs font-semibold text-brand transition-colors hover:text-foreground"
            >
                Edit in Settings
            </Link>
        </div>
    );
}
