"use client";

/**
 * SERP impression tracking: fires one `results_impressed` event per batch of
 * rows the visitor actually scrolled to, instead of one event per card
 * (`ANALYTICS_EVENTS.results_impressed`'s doc comment, events.ts). The
 * decision logic (what's pending, what's already been reported, what a
 * flush drains) is pure — `impression-batch.ts`, same directory — this hook
 * is only the DOM/timer plumbing around it: an IntersectionObserver marks
 * rows ≥50% visible, a MutationObserver picks up rows added later (infinite
 * scroll, a new search replacing the list), and a 1s debounce coalesces
 * bursts (a fast scroll through 10 rows) into one capture.
 *
 * Mount once against the results container (`#jobs-results-list`) — rows
 * are found via `[data-job-id]` (JobCard's root div) rather than threading
 * a ref through every card.
 */

import { useEffect, useRef } from "react";
import { captureEvent, type EventSource } from "@/lib/analytics/events";
import {
  EMPTY_IMPRESSION_BATCH,
  recordImpression,
  flushImpressions,
  type ImpressionBatchState,
} from "@/lib/jobs/impression-batch";

const VISIBLE_THRESHOLD = 0.5;
const FLUSH_DEBOUNCE_MS = 1000;

export function useResultImpressions(
  containerRef: React.RefObject<HTMLElement | null>,
  source: EventSource,
): void {
  const stateRef = useRef<ImpressionBatchState>(EMPTY_IMPRESSION_BATCH);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const flush = () => {
      timerRef.current = null;
      const { jobIds, next } = flushImpressions(stateRef.current);
      stateRef.current = next;
      if (jobIds.length > 0) {
        captureEvent("results_impressed", { job_ids: jobIds, count: jobIds.length, source });
      }
    };

    const scheduleFlush = () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, FLUSH_DEBOUNCE_MS);
    };

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const jobId = (entry.target as HTMLElement).dataset.jobId;
          if (!jobId) continue;
          const before = stateRef.current;
          stateRef.current = recordImpression(stateRef.current, jobId);
          if (stateRef.current !== before) changed = true;
        }
        if (changed) scheduleFlush();
      },
      { threshold: VISIBLE_THRESHOLD },
    );

    const scanForRows = () => {
      container.querySelectorAll<HTMLElement>("[data-job-id]").forEach((row) => {
        intersectionObserver.observe(row);
      });
    };

    scanForRows();
    const mutationObserver = new MutationObserver(scanForRows);
    mutationObserver.observe(container, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      intersectionObserver.disconnect();
      if (timerRef.current != null) clearTimeout(timerRef.current);
      // Don't lose a still-pending batch to an unmount (e.g. the visitor
      // navigates away from /jobs entirely) — flush whatever was seen.
      flush();
    };
    // Re-running this on `source` change would re-scan + re-observe every
    // row for a prop that only tags the payload — `source` is read fresh
    // inside the effect via closure instead. Source is static per mount in
    // practice (SERP's `source` is always "serp").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);
}
