"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { FlagIcon } from "@phosphor-icons/react";
import { usePostHog } from "posthog-js/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  isPostHogClientReady,
  isPostHogReportListingConfigured,
  reportListingFeedback,
  triggerReportListingClick,
  triggerReportListingWithRetry,
  type ReportListingTriggerResult,
} from "@/lib/analytics/report-listing-trigger";
import type { ReportListingJob } from "@/lib/analytics/report-listing";
import { cn } from "@/lib/utils";

export function ReportListingButton({
  job,
  className,
}: {
  job: ReportListingJob;
  className?: string;
}) {
  const posthog = usePostHog();
  const configured = isPostHogReportListingConfigured();
  const sdkReady = isPostHogClientReady(posthog);
  const retryAbortRef = useRef<AbortController | null>(null);
  const [feedback, setFeedback] = useState<string | null>(() =>
    configured ? null : "Report listing isn't available right now.",
  );
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return () => {
      retryAbortRef.current?.abort();
    };
  }, []);

  const applyFeedback = useCallback((result: ReportListingTriggerResult, loading: boolean) => {
    setFeedback(reportListingFeedback(result, loading));
  }, []);

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    if (pending) return;

    retryAbortRef.current?.abort();
    const controller = new AbortController();
    retryAbortRef.current = controller;

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const immediate = triggerReportListingClick(posthog, job, origin, configured);
    if (immediate.status === "triggered") {
      applyFeedback(immediate, false);
      return;
    }
    if (immediate.status === "unconfigured") {
      applyFeedback(immediate, false);
      return;
    }

    setPending(true);
    applyFeedback(immediate, true);
    const result = await triggerReportListingWithRetry(
      () => posthog,
      job,
      origin,
      configured,
      undefined,
      controller.signal,
    );
    if (controller.signal.aborted) return;
    setPending(false);
    applyFeedback(result, false);
  };

  const tooltip = pending ? "Loading report form…" : feedback ?? "Report listing";
  const unavailable = !configured;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip open={feedback ? true : undefined}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Report listing"
            aria-busy={pending}
            aria-disabled={unavailable || undefined}
            data-testid="report-listing-trigger"
            data-report-listing-state={
              unavailable ? "unconfigured" : pending ? "loading" : sdkReady ? "ready" : "booting"
            }
            onClick={handleClick}
            disabled={unavailable}
            className={cn(
              "inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
              unavailable && "cursor-not-allowed opacity-50",
              pending && "opacity-70",
              className,
            )}
          >
            <FlagIcon size={14} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          className="text-xs"
          role="status"
          data-rulebook-exempt={unavailable || undefined}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
