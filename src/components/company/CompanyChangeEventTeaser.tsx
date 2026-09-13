import React from "react";
import { eventTypeLabel, humanizeProjectorHeadline } from "@/lib/companies/events";
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
  const { label: tone } = directionStyle(event.direction);

  return (
    <div
      data-testid="company-change-event-teaser"
      className="border border-border bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {label && (
          <span className={cn("text-xs font-semibold", tone)}>
            {label}
          </span>
        )}
        <span className="text-sm leading-snug text-foreground">
          {humanizeProjectorHeadline(event.headline)}
        </span>
        {date && <span className="text-xs text-muted-foreground">· {date}</span>}
      </div>
    </div>
  );
}
