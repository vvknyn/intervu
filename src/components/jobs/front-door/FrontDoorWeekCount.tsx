"use client";

import { useEffect, useState } from "react";
import { getFrontDoorWeekCountAction } from "@/actions/jobs";
import { frontDoorWeekCountLine } from "@/lib/jobs/front-door-state";

/**
 * The /jobs front door's live line under the search box: how many roles
 * were posted this week where the visitor is. The front door shows no job
 * rows (a list needs a reason: a résumé, a search, or the job the visitor
 * came for), so this is what says the board is alive. Tapping it is the
 * visitor's own choice to see that week's list. Renders nothing until an
 * honest count is back (`getFrontDoorWeekCountAction` returns `null` for
 * rate limits, search outages and zero).
 */
export function FrontDoorWeekCount({
    suppressLocationDefault,
    onShow,
}: {
    suppressLocationDefault: boolean;
    onShow: () => void;
}) {
    const [line, setLine] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getFrontDoorWeekCountAction(suppressLocationDefault)
            .then((res) => {
                if (!cancelled) setLine(res ? frontDoorWeekCountLine(res.count, res.iso2) : null);
            })
            .catch(() => {
                if (!cancelled) setLine(null);
            });
        return () => {
            cancelled = true;
        };
    }, [suppressLocationDefault]);

    if (!line) return null;

    return (
        <div className="mt-3 w-full text-left">
            <button
                type="button"
                data-testid="front-door-week-count"
                onClick={onShow}
                className="inline-flex items-center gap-1.5 mono-data text-xs font-semibold text-brand underline-offset-4 hover:underline"
            >
                <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-live" />
                {line}
            </button>
        </div>
    );
}
