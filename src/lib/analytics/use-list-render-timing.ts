"use client";

import { useEffect, useRef, type RefObject } from "react";
import { captureEvent } from "@/lib/analytics/events";

/**
 * Sends `list_rendered` once per result set, so the 2-second list budget can
 * be read from real visitors instead of a lab profile. Timed to the frame
 * after the rows commit (two animation frames), which is when they are
 * actually on screen.
 *
 * "first_load" only for the first list of a page load that started at /jobs:
 * `performance.now()` counts from the document's navigation start, so it is
 * the honest "opened the page → saw rows" number. Every later list, and a
 * first list reached by client-side navigation, is timed from its own
 * request start instead.
 */
let firstLoadReported = false;

function openedAtJobs(): boolean {
    try {
        const nav = performance.getEntriesByType("navigation")[0];
        return !!nav && new URL(nav.name).pathname.startsWith("/jobs");
    } catch {
        return false;
    }
}

export function useListRenderTiming(input: {
    searchId: string | undefined;
    rows: number;
    loading: boolean;
    surface: "search" | "browse";
    /** `performance.now()` when the request for this result set started,
     *  written by the caller's search effect. */
    requestStartedAtRef: RefObject<number | null>;
    narrow: boolean;
}): void {
    const reported = useRef<string | null>(null);
    const { searchId, rows, loading, surface, requestStartedAtRef, narrow } = input;

    useEffect(() => {
        if (!searchId || loading || rows === 0 || reported.current === searchId) return;
        reported.current = searchId;
        const firstLoad = !firstLoadReported && openedAtJobs();
        firstLoadReported = true;
        const startedAt = firstLoad ? 0 : requestStartedAtRef.current;
        if (startedAt === null) return;
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                captureEvent("list_rendered", {
                    phase: firstLoad ? "first_load" : "search",
                    ms: Math.round(performance.now() - startedAt),
                    surface,
                    rows,
                    viewport: narrow ? "narrow" : "wide",
                });
            });
        });
        return () => cancelAnimationFrame(frame);
    }, [searchId, rows, loading, surface, requestStartedAtRef, narrow]);
}
