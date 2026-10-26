import { useEffect, useRef } from "react";
import { captureEvent, type EventPayloads, type EventSource } from "@/lib/analytics/events";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * The `job_viewed` payload: the job and where it was opened from, nothing
 * about the viewer. It takes no résumé and no match score, so nothing derived
 * from either can reach PostHog through it.
 */
export function buildJobViewedPayload(
  job: Pick<PublicJob, "id" | "company_domain">,
  source: EventSource,
): EventPayloads["job_viewed"] {
  return { job_id: job.id, company_domain: job.company_domain, source };
}

/** Fires `job_viewed` at most once per `job.id` mount. */
export function useJobViewedCapture({ job, source }: { job: PublicJob; source: EventSource }) {
  const viewedJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (viewedJobIdRef.current === job.id) return;
    viewedJobIdRef.current = job.id;
    captureEvent("job_viewed", buildJobViewedPayload(job, source));
    // A source change alone must not count a second view of the same job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);
}
