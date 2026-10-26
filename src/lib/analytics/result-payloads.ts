import type { EventPayloads, EventSource } from "@/lib/analytics/events";
import type { PendingImpression } from "@/lib/jobs/impression-batch";

/**
 * `result_clicked` for a row opened from a result list. On a résumé-shaped list (`listShapedByResume`) the row's
 * position is left out: the order is how the résumé fits. The job id stays, it is the visitor's own action.
 */
export function resultClickedPayload(
  click: { jobId: string; position: number; resumeShaped: boolean },
  extra: Pick<EventPayloads["result_clicked"], "query_id" | "posted_age_days">,
): EventPayloads["result_clicked"] {
  return {
    ...(click.resumeShaped ? {} : { position: click.position }),
    job_id: click.jobId,
    source: "serp",
    ...extra,
  };
}

/** `results_impressed` for a batch of rows scrolled into view. On a résumé-shaped list only the count goes: no ids, no positions. */
export function resultsImpressedPayload(
  impressions: readonly PendingImpression[],
  ctx: { source: EventSource; queryId: string; resumeShaped: boolean },
): EventPayloads["results_impressed"] {
  return {
    ...(ctx.resumeShaped
      ? {}
      : { job_ids: impressions.map((i) => i.jobId), positions: impressions.map((i) => i.position) }),
    count: impressions.length,
    source: ctx.source,
    ...(ctx.queryId ? { query_id: ctx.queryId } : {}),
  };
}
