"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { X } from "@phosphor-icons/react";
import { getJobByIdAction } from "@/actions/jobs";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { PublicJobDetail } from "@/components/jobs/PublicJobDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkFreshness } from "@/lib/jobs/badges";
import { decodeText, ghostMetaFor, locationText, prettyEnum, salaryText } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Rendered-list cap — both the default (no-query) preview and a search
 *  match list stop here. One constant, so "how many roles do we ever draw
 *  at once" can't drift between the two states. */
const ROLES_PREVIEW = 10;

function roleMeta(job: PublicJob): string {
  const parts = [locationText(job), salaryText(job), prettyEnum(job.experience_level)].filter(Boolean);
  return parts.join(" · ");
}

/**
 * The role row's one-line ghost verdict, read from the shared chokepoint.
 *
 * It used to be hand-rolled, and every way it could disagree with the rest of
 * the product, it did: it passed `stale: false` unconditionally (so a verdict
 * from a 90-day-old check rendered as current), it hardcoded "Live · no ghost
 * signals" for `clear`, and — because that branch also matched `!job.ghost_badge`
 * — it printed the same green "Live" claim for jobs that had never been scored
 * at all. `ghostMetaFor` returns null for `unscored`, which is the contract
 * every other surface honours: no verdict, no line.
 */
function roleGhostLine(job: PublicJob, now: number): { text: string; live: boolean } | null {
  const meta = ghostMetaFor(job, now);
  if (!meta) return null;
  const live = job.ghost_badge === "clear" && checkFreshness(job, now) === "fresh";
  return { text: `${live ? "" : "● "}${meta.label}`, live };
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
 * that used to render unconditionally in `page.tsx`.
 *
 * When a user opens any role, it displays in a rich modal in-place without navigating away.
 */
export function CompanyRoleSearch({
  jobs,
  companyDomain,
  companyName,
  openCountLabel,
  searchesPartialWindow,
  jobsSearchUrl,
  now,
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
  /** Server-supplied clock, same contract as CompanyRolesList: the ghost
   *  verdict's staleness read stays pure and testable — never Date.now()
   *  in a render body, which would also desync client and server HTML. */
  now: number;
}) {
  const [query, setQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState<PublicJob | null>(null);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  const matched = hasQuery ? jobs.filter((job) => jobMatchesQuery(job, trimmedQuery)) : jobs;
  const displayed = matched.slice(0, ROLES_PREVIEW);

  // Close modal on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setSelectedJob(null);
    }
  }, []);

  useEffect(() => {
    if (selectedJob) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [selectedJob, handleKeyDown]);

  const modalScrollRef = useRef<HTMLDivElement>(null);

  const handleOpenRelated = useCallback(
    async (jobId: string, directJob?: PublicJob) => {
      if (directJob) {
        setSelectedJob(directJob);
        modalScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const found = jobs.find((j) => j.id === jobId);
      if (found) {
        setSelectedJob(found);
        modalScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      try {
        const fetched = await getJobByIdAction(jobId);
        if (fetched) {
          setSelectedJob(fetched);
          modalScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          toast.error("Could not load job details");
        }
      } catch {
        toast.error("Could not load job details");
      }
    },
    [jobs],
  );

  return (
    <section data-testid="company-role-search">
      <h2 className="mb-4 flex items-baseline justify-between font-display text-[20px] font-semibold">
        Open roles
        {jobs.length > 0 && (
          <span className="text-xs font-normal text-muted-foreground" aria-live="polite">
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
            <p className="mt-2 text-[11px] text-muted-foreground">
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
            const ghost = roleGhostLine(job, now);
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => setSelectedJob(job)}
                  className="w-full text-left flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-xs transition-all hover:border-border-strong hover:bg-chip/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer group"
                >
                  <CompanyLogo domain={companyDomain} name={companyName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-foreground group-hover:text-brand transition-colors">
                      {decodeText(job.title)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {roleMeta(job)}
                    </div>
                    {ghost && (
                      <div
                        className={cn(
                          "mt-1.5 flex items-center gap-1.5 text-[11px]",
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
                  <span className="shrink-0 text-xs text-muted-foreground group-hover:text-brand group-hover:translate-x-0.5 transition-all" aria-hidden>
                    View role →
                  </span>
                </button>
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

      {/* ── JOB DETAILS MODAL (IN-PLACE WITHOUT NAVIGATING AWAY) ── */}
      {selectedJob && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={selectedJob.title}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedJob(null);
            }
          }}
        >
          <div ref={modalScrollRef} className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl sm:rounded-3xl border border-border bg-card shadow-2xl p-4 sm:p-8 animate-in zoom-in-95 duration-200">
            {/* Close Button */}
            <div className="sticky top-0 z-20 -mt-2 -mr-2 mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedJob(null)}
                aria-label="Close job details"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            {/* Public Job Detail Content */}
            <PublicJobDetail
              job={selectedJob}
              onClose={() => setSelectedJob(null)}
              onOpenRelated={handleOpenRelated}
            />
          </div>
        </div>
      )}
    </section>
  );
}
