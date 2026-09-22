import { useEffect, useRef } from "react";
import { captureEvent, type EventSource } from "@/lib/analytics/events";
import { matchAnalyticsProps } from "@/lib/analytics/match-props";
import { recordGuestJobView } from "@/lib/auth/guest-engage-nudge";
import { scoreJobAgainstResume, type MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

/**
 * Fires `job_viewed` at most once per `job.id` mount. While `matchPending` is
 * true (PublicJobDetail waiting on auth + résumé), capture is deferred; an
 * unmount or `job.id` change before pending clears flushes one unscored view.
 */
export function useJobViewedCapture({
  job,
  source,
  signedIn,
  matchPending = false,
  matchScore = null,
  resume = null,
}: {
  job: PublicJob;
  source: EventSource;
  signedIn: boolean;
  matchPending?: boolean;
  matchScore?: MatchScore | null;
  resume?: ResumeData | null;
}) {
  const viewedJobIdRef = useRef<string | null>(null);
  // Updated every render so a bounce during `matchPending` flushes the latest
  // source/signed-in state. The cleanup must not read this when `job.id` has
  // already moved on — that render has overwritten it with the next job.
  const liveRef = useRef({
    id: job.id,
    source,
    signedIn,
    company_domain: job.company_domain,
  });
  liveRef.current = {
    id: job.id,
    source,
    signedIn,
    company_domain: job.company_domain,
  };

  useEffect(() => {
    // Reset so a new id (and React Strict Mode's fake unmount) can still
    // capture. The settled effect below runs after this in the same commit
    // and sets the ref again when it actually sends.
    viewedJobIdRef.current = null;

    const id = job.id;
    const mounted = {
      source,
      signedIn,
      company_domain: job.company_domain,
    };

    return () => {
      if (viewedJobIdRef.current === id) return;
      viewedJobIdRef.current = id;
      const live = liveRef.current;
      const snap = live.id === id ? live : mounted;
      captureEvent("job_viewed", {
        job_id: id,
        company_domain: snap.company_domain,
        source: snap.source,
      });
      if (!snap.signedIn) recordGuestJobView();
    };
    // Depending on source/signedIn would flush an unscored view on the auth
    // flip; the ref would then drop the scored capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  useEffect(() => {
    if (matchPending) return;
    if (viewedJobIdRef.current === job.id) return;

    viewedJobIdRef.current = job.id;
    const score = matchScore ?? (resume ? scoreJobAgainstResume(resume, job) : null);
    captureEvent("job_viewed", {
      job_id: job.id,
      company_domain: job.company_domain,
      source,
      ...matchAnalyticsProps(score),
    });
    if (!signedIn) recordGuestJobView();
  }, [job, matchPending, matchScore, resume, source, signedIn]);
}
