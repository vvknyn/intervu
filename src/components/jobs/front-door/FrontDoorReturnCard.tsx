"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { countNewSinceAction } from "@/actions/jobs";
import { formatNewSinceVisit } from "@/lib/jobs/format-new-since-visit";
import { DEFAULT_URL_STATE } from "@/lib/jobs/url-state";
import { hasVisitCursor, readVisitCursor, writeVisitCursor } from "@/lib/jobs/visit-cursor";
import type { CorpusCount } from "@/lib/jobs/corpus-count";

const DISMISS_KEY = "intervu.jobs.returnCardDismissed";

function isDismissedThisSession(): boolean {
    if (typeof sessionStorage === "undefined") return false;
    try {
        return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
        return false;
    }
}

function dismissForSession(): void {
    if (typeof sessionStorage === "undefined") return;
    try {
        sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
        /* private mode */
    }
}

/**
 * Anonymous return card for /jobs at rest — the most recent stored search
 * plus "N new since your last visit". Uses the shared visit-cursor store
 * (`scope: "jobs"`) and `countNewSinceAction` (same path as
 * SavedSearchesPanel's saved-search counts). Updates the jobs visit cursor
 * after computing the delta (or immediately when no card is shown).
 */
export function FrontDoorReturnCard({
    recentQuery,
    onRerun,
}: {
    recentQuery: string;
    onRerun: (query: string) => void;
}) {
    const [newCount, setNewCount] = useState<CorpusCount | null>(null);
    const [dismissed, setDismissed] = useState(isDismissedThisSession);
    const [showCard, setShowCard] = useState(false);

    useEffect(() => {
        const trimmed = recentQuery.trim();
        const nowIso = new Date().toISOString();

        if (!trimmed || dismissed) {
            writeVisitCursor("jobs", nowIso);
            return;
        }

        if (!hasVisitCursor("jobs")) {
            writeVisitCursor("jobs", nowIso);
            return;
        }

        setShowCard(true);
        let cancelled = false;
        const cursor = readVisitCursor("jobs");
        void (async () => {
            const count = await countNewSinceAction(
                { scope: "saved", params: { ...DEFAULT_URL_STATE, q: trimmed } },
                cursor,
            );
            if (cancelled) return;
            setNewCount(count.value >= 1 ? count : null);
            writeVisitCursor("jobs", nowIso);
        })();

        return () => {
            cancelled = true;
        };
    }, [dismissed, recentQuery]);

    if (dismissed || !showCard || !recentQuery.trim()) {
        return null;
    }

    return (
        <div
            data-testid="front-door-return-card"
            className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-[var(--list-inset)] pb-3 pt-2 text-sm"
        >
            <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{recentQuery}</p>
                {newCount && (
                    <p className="mt-0.5 text-xs font-semibold text-brand">
                        {formatNewSinceVisit(newCount)} since your last visit
                    </p>
                )}
            </div>
            <span className="inline-flex shrink-0 items-center gap-2">
                <button
                    type="button"
                    onClick={() => onRerun(recentQuery)}
                    className="ctl-md rounded-ctl border border-border bg-surface px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                >
                    Run search
                </button>
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => {
                        dismissForSession();
                        setDismissed(true);
                    }}
                    className="ctl-md flex ctl-square items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                >
                    <X size={16} aria-hidden />
                </button>
            </span>
        </div>
    );
}
