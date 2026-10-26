import React from "react";
import type { CompanyIntelligence } from "@/lib/companies/types";
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

/**
 * Follower-only company details: the languages and tools the job posts name,
 * and news. Flat sections on the page background (rulebook item g), no icons
 * and no hover on anything that isn't a link.
 *
 * Two facts that used to live here are shown once elsewhere now: the stage
 * (the "Capital & stage" card only ever repeated `company_stage`, already in
 * the header's facts row) and visa sponsorship (the public stat row counts
 * it). A section renders only when it has something to say.
 */
export function CompanyIntelligenceGrid({
  intelligence,
  companyName,
  className,
}: CompanyIntelligenceGridProps) {
  if (!intelligence) return null;
  const { techStack, news } = intelligence;
  const stackWords = techStack ? [...techStack.languages.slice(0, 5), ...techStack.infrastructure.slice(0, 3)] : [];
  if (stackWords.length === 0 && news.length === 0) return null;

  return (
    <section aria-label="Company details" className={cn("space-y-8", className)}>
      {stackWords.length > 0 && (
        <div data-testid="company-job-post-stack" className="border-t border-border pt-6">
          <h2 className="text-base font-semibold leading-snug text-foreground">Languages and tools in their job posts</h2>
          <p className="mt-2 text-sm text-foreground">{stackWords.join(" · ")}</p>
          <p className="mono-data mt-2 text-xs text-muted-foreground">From active job listings</p>
        </div>
      )}

      {/* COMPANY NEWS FEED — real articles from the Subspace news API */}
      {news.length > 0 && (
        <div className="border-t border-border pt-6">
          <h2 className="text-base font-semibold leading-snug text-foreground">{companyName} in the news</h2>
          <ul className="mt-2">
            {news.map((item, idx) => {
              const dateLabel = articleDate(item.published_at);
              return (
                // RSS genuinely republishes the same URL across feeds, so the
                // url alone is not a unique key. The list is render-once and
                // never reordered, so the index disambiguates safely.
                <li key={`${item.url}::${idx}`} className="border-b border-border">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block py-4 transition-colors hover:bg-muted focus-visible:inset-outline-2 focus-visible:outline-brand"
                  >
                    <p className="text-base font-semibold leading-snug text-foreground group-hover:text-brand">{item.title}</p>
                    {item.summary && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.summary}</p>
                    )}
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.publisher}
                      {dateLabel ? ` · ${dateLabel}` : ""}
                    </p>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
