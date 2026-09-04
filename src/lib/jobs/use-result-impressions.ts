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
 * are found via `[data-job-id]`/`[data-position]` (JobCard's root div)
 * rather than threading a ref through every card.
 *
 * `queryId` identifies the rendered result set (one uuid per search — the
 * same value the caller passes to `result_clicked`/`apply_clicked`, SPEC
 * §5). A change re-arms the tracker: the impression batch resets to empty
 * rather than carrying another query's `reported`/`pending` state forward,
 * so a REFINED search's rows — even ones already seen under the previous
 * query — start eligible for a fresh impression (impression-batch.ts's
 * `${queryId}:${jobId}` dedupe key already makes this safe on its own; the
 * reset just keeps `reported` from growing across an entire session).
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
  queryId: string,
): void {
  const stateRef = useRef<ImpressionBatchState>(EMPTY_IMPRESSION_BATCH);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // A new queryId means a new rendered result set — start its impression
    // batch fresh (see the module doc comment above for why this is safe
    // alongside, not instead of, the queryId-scoped dedupe key).
    stateRef.current = EMPTY_IMPRESSION_BATCH;

    const flush = () => {
      timerRef.current = null;
      const { impressions, next } = flushImpressions(stateRef.current);
      stateRef.current = next;
      if (impressions.length > 0) {
        captureEvent("results_impressed", {
          job_ids: impressions.map((i) => i.jobId),
          positions: impressions.map((i) => i.position),
          count: impressions.length,
          source,
          ...(queryId ? { query_id: queryId } : {}),
        });
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
          const target = entry.target as HTMLElement;
          const jobId = target.dataset.jobId;
          const position = Number(target.dataset.position);
          if (!jobId || !Number.isFinite(position) || position <= 0) continue;
          const before = stateRef.current;
          stateRef.current = recordImpression(stateRef.current, queryId, jobId, position);
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
    // practice (SERP's `source` is always "serp"). `queryId` IS a real
    // dependency: see the re-arm comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, queryId]);
}
