import { buildReportListingPayload, type ReportListingJob } from "@/lib/analytics/report-listing";

export type ReportListingTriggerResult =
  | { status: "triggered" }
  | { status: "not_loaded" }
  | { status: "unconfigured" }
  | { status: "aborted" };

/** Minimal PostHog client surface used by report-listing. */
export type PostHogReportClient = {
  __loaded?: boolean;
  register: (props: Record<string, unknown>) => void;
  capture: (event: string, props: Record<string, unknown>) => void;
};

export function isPostHogReportListingConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim());
}

export function isPostHogClientReady(posthog: PostHogReportClient | null | undefined): boolean {
  return Boolean(posthog && posthog.__loaded === true);
}

export function triggerReportListingClick(
  posthog: PostHogReportClient | null | undefined,
  job: ReportListingJob,
  origin: string,
  configured: boolean = isPostHogReportListingConfigured(),
): ReportListingTriggerResult {
  if (!configured) return { status: "unconfigured" };
  if (!isPostHogClientReady(posthog)) return { status: "not_loaded" };

  const { register, capture } = buildReportListingPayload(job, origin);
  posthog!.register(register);
  posthog!.capture("job_report_clicked", capture);
  return { status: "triggered" };
}

export type ReportListingRetryOptions = {
  attempts: number;
  delayMs: number;
};

export const REPORT_LISTING_RETRY: ReportListingRetryOptions = {
  attempts: 12,
  delayMs: 250,
};

export function reportListingFeedback(result: ReportListingTriggerResult, pending: boolean): string | null {
  if (result.status === "triggered" || result.status === "aborted") return null;
  if (result.status === "unconfigured") return "Report listing isn't available right now.";
  if (pending) return "Loading report form…";
  return "Report listing isn't ready yet. Try again.";
}

export async function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function triggerReportListingWithRetry(
  getPosthog: () => PostHogReportClient | null | undefined,
  job: ReportListingJob,
  origin: string,
  configured: boolean = isPostHogReportListingConfigured(),
  retry: ReportListingRetryOptions = REPORT_LISTING_RETRY,
  signal?: AbortSignal,
): Promise<ReportListingTriggerResult> {
  let last = triggerReportListingClick(getPosthog(), job, origin, configured);
  if (last.status === "triggered" || last.status === "unconfigured") return last;

  for (let attempt = 0; attempt < retry.attempts; attempt += 1) {
    if (signal?.aborted) return { status: "aborted" };
    await waitMs(retry.delayMs, signal);
    if (signal?.aborted) return { status: "aborted" };
    last = triggerReportListingClick(getPosthog(), job, origin, configured);
    if (last.status === "triggered" || last.status === "unconfigured") return last;
  }
  return last;
}
