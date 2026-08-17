"use client";

import { useState } from "react";
import Link from "next/link";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decodeText, ghostMetaFor, locationText, prettyEnum, salaryText } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

/** Rendered-list cap — both the default (no-query) preview and a search
 *  match list stop here. One constant, so "how many roles do we ever draw
 *  at once" can't drift between the two states. */
const ROLES_PREVIEW = 10;

function roleMeta(job: PublicJob): string {
  const parts = [locationText(job), salaryText(job), prettyEnum(job.experience_level)].filter(Boolean);
  return parts.join(" · ");
}

function roleGhostLine(job: PublicJob): { text: string; live: boolean } | null {
  if (job.ghost_badge === "likely_ghost") {
    const meta = ghostMetaFor(job.ghost_badge, false);
    return meta ? { text: `● ${meta.label}`, live: false } : null;
  }
  if (job.ghost_badge === "clear" || !job.ghost_badge) {
    return { text: "Live · no ghost signals", live: true };
  }
  return null;
}

/**
 * True iff `job` matches `query` on any of title, location, or experience
 * level — the three fields the box searches (spec: "filter ALL loaded roles
 * case-insensitively across title, location, and experience level"). Reads
 * through the same display helpers the row itself renders with
 * (`locationText`/`prettyEnum`), so a match is always on text the visitor can
 * actually see next to the input, not a raw field they can't. Deliberately
 * excludes salary — `roleMeta` folds it in for the row's caption line, but
 * the spec names only these three fields as searchable.
 */
export function jobMatchesQuery(job: PublicJob, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [decodeText(job.title), locationText(job), prettyEnum(job.experience_level)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** The "N of M ..." caption beside the "Open roles" heading — truthful about
 *  what's rendered vs. what the query actually matched, in both directions
 *  (identical to the pre-search "N of M shown" copy when there's no query). */
function roleCountLabel(
  displayedCount: number,
  matchedCount: number,
  hasQuery: boolean,
  openCountLabel: string,
): string {
  if (!hasQuery) return `${displayedCount} of ${openCountLabel} shown`;
  if (displayedCount === matchedCount) {
    return `${matchedCount} match${matchedCount === 1 ? "" : "es"}`;
  }
  return `${displayedCount} of ${matchedCount} matches shown`;
}

/**
 * Filter-in-place box over this company's already-fetched roles (`jobs` —
 * server-fetched once, up to `COMPANY_JOBS_FETCH_LIMIT`) plus the roles list
 * that used to render unconditionally in `page.tsx`. Moved here as one unit
 * because the heading's count line and the footer CTA both need to react to
 * the same filter state the input owns.
 *
 * No debounce: the data is already local, filtering 200 rows is trivial, and
 * a debounced local filter is a delay with no upstream request behind it to
 * justify it (standard filter-within-results pattern, ui-patterns.com).
 */
export function CompanyRoleSearch({
  jobs,
  companyDomain,
  companyName,
  openCountLabel,
  searchesPartialWindow,
  jobsSearchUrl,
}: {
  jobs: PublicJob[];
  companyDomain: string;
  companyName: string;
  /** Pre-formatted company-wide open-role count (`openCountText(data)`) —
   *  one string, shared with the KPI tile above so the two can't disagree. */
  openCountLabel: string;
  /** True when `jobs` is less than the whole employer, so this box searches a
   *  slice and must say so. Decided by `searchWindowIsPartial` — deliberately
   *  NOT `openCountIsLowerBound`, which answers the unrelated question "is the
   *  COUNT trustworthy?" and is false for the very employers with the most
   *  roles left unloaded. See lib/companies/open-count.ts. */
  searchesPartialWindow: boolean;
  jobsSearchUrl: string;
}) {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  const matched = hasQuery ? jobs.filter((job) => jobMatchesQuery(job, trimmedQuery)) : jobs;
  const displayed = matched.slice(0, ROLES_PREVIEW);

  return (
    <section>
      <h2 className="mb-4 flex items-baseline justify-between font-display text-[20px] font-semibold">
        Open roles
        {jobs.length > 0 && (
          <span className="font-mono text-xs font-normal text-muted-foreground" aria-live="polite">
            {roleCountLabel(displayed.length, matched.length, hasQuery, openCountLabel)}
          </span>
        )}
      </h2>

      {jobs.length > 0 && (
        <div className="mb-4">
          <label htmlFor="company-role-search" className="sr-only">
            Search {companyName}&apos;s open roles by title, location, or level
          </label>
          <Input
            id="company-role-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={`Search ${companyName}'s open roles…`}
          />
          {searchesPartialWindow && hasQuery && (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Searching the {jobs.length} most recent roles —{" "}
              <Link href={jobsSearchUrl} className="text-brand hover:underline">
                use full search
              </Link>{" "}
              for all.
            </p>
          )}
        </div>
      )}

      {displayed.length === 0 ? (
        hasQuery ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No open roles match &ldquo;{trimmedQuery}&rdquo;.
            </p>
            <Link href={jobsSearchUrl} className="mt-2 inline-block text-sm text-brand hover:underline">
              Search all jobs at {companyName} →
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No open roles indexed right now.</p>
        )
      ) : (
        <ul className="space-y-2.5">
          {displayed.map((job) => {
            const ghost = roleGhostLine(job);
            return (
              <li key={job.id}>
                <Link
                  href={`/jobs?job=${encodeURIComponent(job.id)}`}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-xs transition-colors hover:border-border-strong"
                >
                  <CompanyLogo domain={companyDomain} name={companyName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">{decodeText(job.title)}</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {roleMeta(job)}
                    </div>
                    {ghost && (
                      <div
                        className={cn(
                          "mt-1.5 flex items-center gap-1.5 font-mono text-[11px]",
                          ghost.live ? "text-brand" : "text-muted-foreground",
                        )}
                      >
                        {ghost.live && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand animate-pulse" aria-hidden />
                        )}
                        {ghost.text}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground" aria-hidden>
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {displayed.length > 0 && (
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
          <div>
            <h3 className="font-display text-[18px] font-semibold text-foreground">
              Explore all {openCountLabel} open roles at {companyName}
            </h3>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              Screened for ghost-job risk, posting freshness, and verified salary transparency.
            </p>
          </div>
          <Button asChild variant="brand" size="lg" className="h-11 px-6 font-semibold shrink-0">
            <Link href={jobsSearchUrl}>
              View all {openCountLabel} jobs →
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}
