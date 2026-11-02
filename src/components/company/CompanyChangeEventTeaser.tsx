import React from "react";
import { eventTypeLabel, humanizeProjectorHeadline } from "@/lib/companies/events";
import type { CompanyChangeEvent } from "@/lib/companies/types";
import { cn } from "@/lib/utils";
import { directionStyle, eventDate } from "@/components/company/CompanyChangeEvents";
import { FactLine } from "@/components/ui/fact-line";

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
      className="border-t border-border pt-4"
    >
      {/* The date is its own fact: a "·" never ends or starts a wrapped line (FactLine). */}
      <FactLine
        className="items-baseline"
        items={[
          <>
            {label && <span className={cn("mr-2 text-xs font-semibold", tone)}>{label}</span>}
            <span className="text-sm leading-snug text-foreground">{humanizeProjectorHeadline(event.headline)}</span>
          </>,
          date && <span className="text-xs text-muted-foreground">{date}</span>,
        ]}
      />
    </div>
  );
}
