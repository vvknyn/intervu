"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared /trends section grammar (data-surfaces redesign proposal, §02 +
 * §05#1). Before this, each of the seven /trends sections hand-rolled its
 * own header (icon square + h2 + description + decorative micro-badge like
 * "AGE DECAY" / "INTEGRITY SCAN" / "14-Day Velocity") and its own bar row —
 * the same two patterns rebuilt independently five times, four of them
 * wrapped in a glass/backdrop-blur card and three plain. `TrendSection` is
 * the one header (mono-data section label + an optional honest right-slot
 * fact — "the right-slot line now carries a fact or nothing", never a
 * decorative badge) and `BarRow` below is the one row (label → track → pct
 * → count, tabular-nums). Every section now renders the same plain house
 * frame — no more glass on four, plain on three.
 */
export function TrendSection({
  testId,
  label,
  asOf,
  intro,
  children,
}: {
  testId?: string;
  label: string;
  asOf?: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-panel border border-border bg-card p-6 transition-colors"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2">
        <span className="text-base font-semibold text-foreground">
          {label}
        </span>
        {asOf && <span className="mono-data text-sm text-muted-foreground">{asOf}</span>}
      </div>
      {intro && <div className="mt-2 text-xs text-muted-foreground">{intro}</div>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Dot + bar-fill tone. `good`/`warn` are the receipt scale — green
 *  favorable, amber caution. Red never appears on this surface (data-surfaces
 *  proposal §02 annotation 2: "the corpus receipt wears the receipt's colors
 *  — green favorable, amber caution (red leaves the palette)"). `neutral` is
 *  the terminal "not really counted" row — unclassified locations, not-yet-
 *  scored postings — a dimmer dot/fill than an ungated data row, never the
 *  full-strength ink fill an ordinary (untoned) row gets. Resolves through
 *  the same STATUS_FILL tokens every other status surface uses for
 *  good/warn — not a new color, a narrower read of the existing scale. */
export type BarRowTone = "good" | "warn" | "neutral";

const DOT_TONE: Record<BarRowTone, string> = {
  good: "bg-st-offer",
  warn: "bg-warn",
  neutral: "bg-muted-foreground",
};

const FILL_TONE: Record<BarRowTone, string> = {
  good: "bg-st-offer",
  warn: "bg-warn",
  neutral: "bg-muted-foreground",
};

/**
 * One row: label (+ optional rank, + optional tone dot) → track → pct →
 * count, tabular-nums throughout. `href` makes the row a link into the
 * filtered board (serializeJobsUrl) — every row that has an honest,
 * precisely-matching filter gets one; a row with no `href` renders `quiet`
 * automatically (muted label, no bottom border) — the same "informational,
 * not a filter" treatment the old per-section unclassified/not-checked rows
 * hand-rolled individually.
 */
export function BarRow({
  testId,
  label,
  rank,
  tone,
  pct,
  pctLabel,
  count,
  href,
}: {
  testId?: string;
  label: ReactNode;
  rank?: number;
  tone?: BarRowTone;
  pct: number;
  pctLabel?: string;
  count: string;
  href?: string;
}) {
  const quiet = !href;
  // Below sm the track drops to its own full-width line under the label,
  // pct and count: on a 320px phone the row box is ~240px wide and the
  // four-column grid needs 288px before the track gets any width, so the
  // bars rendered 0px wide and the counts pushed the page sideways.
  const content = (
    <div
      data-testid={testId}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_40px_64px] items-center gap-x-3 gap-y-1.5 py-2 text-xs transition-colors sm:grid-cols-[minmax(120px,210px)_1fr_44px_88px] sm:gap-y-3",
        !quiet && "border-b border-border",
        href && "hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "flex min-w-0 items-center gap-2 truncate",
          quiet ? "font-normal text-muted-foreground" : "text-foreground",
        )}
      >
        {typeof rank === "number" && (
          <span className="mono-data w-4 shrink-0 text-xs text-muted-foreground">
            {String(rank).padStart(2, "0")}
          </span>
        )}
        {tone && (
          <span
            className={cn("h-2 w-2 shrink-0 rounded-pill", DOT_TONE[tone])}
            aria-hidden
          />
        )}
        <span className={cn("truncate", href && "group-hover:text-brand")}>{label}</span>
      </span>
      <span data-testid="trend-bar-track" className="order-last col-span-3 h-1.5 overflow-hidden rounded-pill bg-muted sm:order-none sm:col-span-1">
        <span
          className={cn(
            "block h-full rounded-pill transition-all",
            tone ? FILL_TONE[tone] : "bg-foreground dark:bg-foreground",
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="mono-data text-right text-xs text-muted-foreground">{pctLabel ?? `${pct}%`}</span>
      <span className="mono-data text-right text-xs font-semibold text-foreground">{count}</span>
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} className="group block">
      {content}
    </Link>
  );
}
