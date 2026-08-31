"use client";

import type { MouseEvent } from "react";
import { FlagIcon } from "@phosphor-icons/react";
import { usePostHog } from "posthog-js/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { buildReportListingPayload, type ReportListingJob } from "@/lib/analytics/report-listing";
import { cn } from "@/lib/utils";

export function ReportListingButton({
  job,
  className,
}: {
  job: ReportListingJob;
  className?: string;
}) {
  const posthog = usePostHog();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    if (!posthog || posthog.__loaded !== true) return;

    const { register, capture } = buildReportListingPayload(
      job,
      typeof window !== "undefined" ? window.location.origin : "",
    );
    posthog.register(register);
    posthog.capture("job_report_clicked", capture);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Report listing"
            data-testid="report-listing-trigger"
            onClick={handleClick}
            className={cn(
              "inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
              className,
            )}
          >
            <FlagIcon size={14} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          Report listing
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
