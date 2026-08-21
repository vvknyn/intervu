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
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
            <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs transition-colors hover:border-border-strong">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <CurrencyDollar className="h-4 w-4 text-emerald-500" weight="bold" />
                    Capital & Stage
                  </span>
                  {funding.stage && (
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
                      {funding.stage}
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  {funding.totalRaisedText ? (
                    <div className="font-display text-[24px] sm:text-[26px] font-bold tracking-tight text-foreground">
                      {funding.totalRaisedText}
                    </div>
                  ) : (
                    <div className="font-display text-[20px] font-semibold text-foreground">
                      {funding.stage}
                    </div>
                  )}

                  {funding.valuationText && (
                    <div className="mt-1.5 text-[13px] font-medium text-muted-foreground">
                      {funding.valuationText}
                    </div>
                  )}
                </div>

                {funding.investors.length > 0 && (
                  <div className="mt-5 border-t border-border pt-4">
                    <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                      Notable Backers
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {funding.investors.map((inv) => (
                        <span
                          key={inv}
                          className="inline-flex items-center rounded-md border border-border bg-chip px-2.5 py-1 text-[11.5px] text-foreground"
                        >
                          {inv}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-2 text-[11.5px] text-muted-foreground">
                Stage reported on the company&apos;s own job listings
              </div>
            </div>
          )}

          {/* CARD 2: Visa sponsorship — share of this company's own open roles flagged as sponsoring */}
          {visa && (
            <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs transition-colors hover:border-border-strong">
              <div>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <GlobeHemisphereWest className="h-4 w-4 text-brand" weight="bold" />
                  Visa & Immigration
                </span>

                <div className="mt-4">
                  <div className="font-display text-[24px] sm:text-[26px] font-bold tracking-tight text-foreground">
                    {visa.sponsoredRolesRatioPct}% Roles Sponsored
                  </div>
                  <div className="mt-1.5 text-[13px] text-muted-foreground">
                    Flagged as visa-sponsoring on the career page
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-2 text-[11.5px] text-muted-foreground">
                Computed from this company&apos;s own open roles
              </div>
            </div>
          )}

          {/* CARD: Tech stack — extracted from active job listings */}
          {hasTechCard && techStack && (techStack.languages.length > 0 || techStack.infrastructure.length > 0) && (
            <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs transition-colors hover:border-border-strong">
              <div>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Code className="h-4 w-4 text-brand" weight="bold" />
                  Tech stack
                </span>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {techStack.languages.slice(0, 5).map((lang) => (
                    <span
                      key={lang}
                      className="inline-flex items-center rounded-md border border-border bg-chip px-2.5 py-1 text-[11.5px] font-medium text-foreground"
                    >
                      {lang}
                    </span>
                  ))}
                  {techStack.infrastructure.slice(0, 3).map((infra) => (
                    <span
                      key={infra}
                      className="inline-flex items-center rounded-md border border-border bg-chip px-2.5 py-1 text-[11.5px] text-muted-foreground"
                    >
                      {infra}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-5 pt-2 text-[11.5px] text-muted-foreground">
                From active job listings
              </div>
            </div>
          )}
        </div>
      )}

      {/* COMPANY NEWS FEED — real articles from the Subspace news API */}
      {news.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs">
          <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Newspaper className="h-4 w-4 text-brand" weight="bold" />
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
                className="flex flex-col justify-between rounded-xl border border-border/70 bg-background/50 p-4 transition-colors hover:border-border-strong"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md border border-brand/20 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">
                      {item.publisher}
                    </span>
                    {dateLabel && (
                      <span className="text-[10.5px] text-muted-foreground">
                        {dateLabel}
                      </span>
                    )}
                  </div>
                  <h4 className="mt-2.5 text-[13.5px] font-semibold leading-snug text-foreground">
                    {item.title}
                  </h4>
                  {item.summary && (
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                      {item.summary}
                    </p>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-brand">
                  <span>Read article</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
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
