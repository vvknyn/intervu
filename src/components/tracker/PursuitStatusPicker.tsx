"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TRACKER_FIELD_CLASS } from "@/components/tracker/field-class";
import type { PursuitStage } from "@/lib/pursuits/types";
import { TRACKER_STATUS_OPTIONS, isCurrentTrackerStatus } from "@/lib/pursuits/tracker-display";
import { cn } from "@/lib/utils";

/**
 * The status dropdown the detail sheet and the full pursuit page share, with
 * one option per `TRACKER_STATUS_OPTIONS` entry, so the two surfaces can
 * never offer different statuses. It was a row of six tabs, which read as
 * navigation rather than a value to set ("this is unintuitive...it should
 * be a dropdown", 2026-10-05). Picking the status the pursuit already has is
 * a no-op, not a second write and a second toast.
 */
export function PursuitStatusPicker({
    status,
    onChange,
    disabled,
}: {
    status: PursuitStage;
    onChange: (status: PursuitStage) => void;
    disabled?: boolean;
}) {
    // `resume_ready` has no option of its own and shows as Saved, the lane it sits in.
    const value = TRACKER_STATUS_OPTIONS.find(({ stage }) => isCurrentTrackerStatus(status, stage))?.stage ?? status;
    return (
        <Select
            value={value}
            disabled={disabled}
            onValueChange={(next) => {
                if (next !== value) onChange(next as PursuitStage);
            }}
        >
            <SelectTrigger aria-label="Status" data-testid="pursuit-status-picker" className={cn(TRACKER_FIELD_CLASS, "max-w-60")}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
                {TRACKER_STATUS_OPTIONS.map(({ stage, label }) => (
                    <SelectItem key={stage} value={stage}>
                        {label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
