"use client";

import { TabItem } from "@/components/ui/tabs";
import type { PursuitStage } from "@/lib/pursuits/types";
import { TRACKER_STATUS_OPTIONS, isCurrentTrackerStatus } from "@/lib/pursuits/tracker-display";

/**
 * The status row the detail sheet and the full pursuit page share: one
 * button per `TRACKER_STATUS_OPTIONS` entry, the current one pressed, so the
 * two surfaces can never offer different statuses. A `.wrap-row` so a phone
 * breaks it into balanced lines instead of stranding "Withdrawn" alone.
 * Picking the status the pursuit already has is a no-op, not a second write
 * and a second toast.
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
    // `-ml-3` pulls the first tab's text onto the label's left edge (a tab
    // carries its own px-3 hit area).
    return (
        <div className="-ml-3">
            <div role="group" aria-label="Status" data-testid="pursuit-status-picker" className="wrap-row [--wrap-gap-x:0rem]">
                {TRACKER_STATUS_OPTIONS.map(({ stage, label }) => {
                    const current = isCurrentTrackerStatus(status, stage);
                    return (
                        <TabItem
                            key={stage}
                            aria-pressed={current}
                            disabled={disabled}
                            onClick={() => {
                                if (!current) onChange(stage);
                            }}
                        >
                            {label}
                        </TabItem>
                    );
                })}
            </div>
        </div>
    );
}
