import React from "react";
import { eventTypeLabel } from "@/lib/companies/events";
import type { CompanyChangeEvent } from "@/lib/companies/types";
import { cn } from "@/lib/utils";
import { directionStyle, eventDate } from "@/components/company/CompanyChangeEvents";

/**
 * One public line from the change-event ledger — a hook for followers to unlock
 * the full list + evidence behind `CompanyIntelGate`. Renders nothing when there
 * is no event to show; silence is the honest empty state.
 */
export function CompanyChangeEventTeaser({ event }: { event: CompanyChangeEvent | null }) {
  if (!event) return null;

  const label = eventTypeLabel(event.event_type);
  const date = eventDate(event.occurred_at);
  const { chip } = directionStyle(event.direction);

  return (
    <div
      data-testid="company-change-event-teaser"
      className="border border-border bg-card px-5 py-3.5"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {label && (
          <span
            className={cn(
              "border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              chip,
            )}
          >
            {label}
          </span>
        )}
        <span className="text-[14px] leading-snug text-foreground">{event.headline}</span>
        {date && <span className="text-[11px] text-muted-foreground">· {date}</span>}
      </div>
    </div>
  );
}
