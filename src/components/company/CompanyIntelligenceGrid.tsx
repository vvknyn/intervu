import React from "react";
import type { CompanyIntelligence } from "@/lib/companies/types";
import {
  CurrencyDollar,
  GlobeHemisphereWest,
  Code,
  Newspaper,
  ArrowUpRight,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

/**
 * "Aug 15, 2026" from the API's ISO-8601 `published_at`.
 *
 * The year is always shown. This news corpus reaches back to Feb 2025, so a
 * bare "Aug 15" would present a year-old story as if it were current — the
 * precise species of quiet overclaim this page was rebuilt to stop making.
 * Rendered in UTC for the same reason `shortDate` is (jobs/presentation.ts):
 * a viewer-local render can roll a date back a day.
 * Returns null on a missing or unparseable stamp so the caller omits the line
 * rather than printing "Invalid Date" — ~11% of ingested articles carry no
 * publish date at all (a feed date-parser gap), and a missing date must read
 * as absent, not as broken.
 */
function articleDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface CompanyIntelligenceGridProps {
  intelligence?: CompanyIntelligence | null;
  companyName: string;
  className?: string;
}

export function CompanyIntelligenceGrid({
  intelligence,
  companyName,
  className,
}: CompanyIntelligenceGridProps) {
  if (!intelligence) return null;
  const { funding, visa, techStack, news } = intelligence;

  // If no intelligence data is available at all, return null gracefully
  const hasAnyData = Boolean(funding || visa || techStack || news.length > 0);
  if (!hasAnyData) return null;

  const hasTechCard = Boolean(techStack);

  return (
    <section aria-label="Company details" className={cn("space-y-5", className)}>
      <h2 className="text-xs font-semibold text-muted-foreground">
        Company details
      </h2>

      {(funding || visa || hasTechCard) && (
        // Card count is genuinely variable (0-4) now that fabricated data no
        // longer guarantees all of them always render. An auto-fitting track
        // — not a hardcoded `md:grid-cols-3` — degrades cleanly at every
        // count: 1 card fills the row instead of sitting alone in empty
        // slots, more cards split the row evenly, and this can't regress as
        // fields come and go.
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
          {/* CARD 1: Capital & Stage — sourced from the company's own job listings */}
          {funding && (
            <div className="flex flex-col justify-between rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-6 sm:p-7 transition-colors hover:border-border-strong">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <CurrencyDollar className="h-4 w-4 text-brand" weight="bold" size={16} />
                    Capital & Stage
                  </span>
                  {funding.stage && (
                    <span className="text-xs font-semibold text-muted-foreground">
                      {funding.stage}
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  {funding.totalRaisedText ? (
                    <div className="font-display text-xl font-semibold text-foreground">
                      {funding.totalRaisedText}
                    </div>
                  ) : (
                    <div className="font-display text-xl font-semibold text-foreground">
                      {funding.stage}
                    </div>
                  )}

                  {funding.valuationText && (
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      {funding.valuationText}
                    </div>
                  )}
                </div>

                {funding.investors.length > 0 && (
                  <div className="mt-5 border-t border-border pt-4">
                    <div className="text-xs text-muted-foreground">
                      Notable Backers
                    </div>
                    <p className="mt-1.5 text-xs text-foreground">
                      {funding.investors.join(" · ")}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-2 text-xs text-muted-foreground">
                Stage reported on the company&apos;s own job listings
              </div>
            </div>
          )}

          {/* CARD 2: Visa sponsorship — share of this company's own open roles flagged as sponsoring */}
          {visa && (
            <div className="flex flex-col justify-between rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-6 sm:p-7 transition-colors hover:border-border-strong">
              <div>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <GlobeHemisphereWest className="h-4 w-4 text-brand" weight="bold" size={16} />
                  Visa & Immigration
                </span>

                <div className="mt-4">
                  <div className="font-display text-xl font-semibold text-foreground">
                    {visa.sponsoredRolesRatioPct}% Roles Sponsored
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Flagged as visa-sponsoring on the career page
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-2 text-xs text-muted-foreground">
                Computed from this company&apos;s own open roles
              </div>
            </div>
          )}

          {/* CARD: Tech stack — extracted from active job listings */}
          {hasTechCard && techStack && (techStack.languages.length > 0 || techStack.infrastructure.length > 0) && (
            <div className="flex flex-col justify-between rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-6 sm:p-7 transition-colors hover:border-border-strong">
              <div>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Code className="h-4 w-4 text-brand" weight="bold" size={16} />
                  Tech stack
                </span>

                <p className="mt-4 text-xs text-foreground">
                  {[...techStack.languages.slice(0, 5), ...techStack.infrastructure.slice(0, 3)].join(" · ")}
                </p>
              </div>

              <div className="mt-5 pt-2 text-xs text-muted-foreground">
                From active job listings
              </div>
            </div>
          )}
        </div>
      )}

      {/* COMPANY NEWS FEED — real articles from the Subspace news API */}
      {news.length > 0 && (
        <div className="mt-6 rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-6 sm:p-7">
          <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Newspaper className="h-4 w-4 text-brand" weight="bold" size={16} />
            {companyName} in the News
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {news.map((item, idx) => {
              const dateLabel = articleDate(item.published_at);
              return (
              <a
                // RSS genuinely republishes the same URL across feeds, so the
                // url alone is not a unique key. The list is render-once and
                // never reordered, so the index disambiguates safely.
                key={`${item.url}::${idx}`}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col justify-between rounded-panel border border-border bg-background p-4 transition-colors hover:border-border-strong"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-brand">
                      {item.publisher}
                    </span>
                    {dateLabel && (
                      <span className="text-xs text-muted-foreground">
                        {dateLabel}
                      </span>
                    )}
                  </div>
                  <h4 className="mt-2.5 text-sm font-semibold leading-snug text-foreground">
                    {item.title}
                  </h4>
                  {item.summary && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {item.summary}
                    </p>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-1 text-xs text-brand">
                  <span>Read article</span>
                  <ArrowUpRight className="h-4 w-4" size={16} weight="bold" />
                </div>
              </a>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
