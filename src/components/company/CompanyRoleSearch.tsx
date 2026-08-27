"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { getJobByIdAction } from "@/actions/jobs";
import { CompanyFollowControl } from "@/components/companies/CompanyFollowControl";
import { PublicJobDetail } from "@/components/jobs/PublicJobDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CircleNotch } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { decodeText, displayCompanyBrand, locationText, prettyEnum, rowExceptionMeta } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { companyRowMetaSegments } from "@/lib/presentation";
import { toast } from "@/lib/toast";

/** Rendered-list cap — both the default (no-query) preview and a search
 *  match list stop here. One constant, so "how many roles do we ever draw
 *  at once" can't drift between the two states. */
const ROLES_PREVIEW = 10;

/**
 * True iff `job` matches `query` on any of title, location, or experience
 * level — the three fields the box searches (spec: "filter ALL loaded roles
 * case-insensitively across title, location, and experience level"). Reads
 * through the same display helpers the row itself renders with
 * (`locationText`/`prettyEnum`), so a match is always on text the visitor can
 * actually see next to the input, not a raw field they can't. Deliberately
 * excludes salary — the row's meta line (`companyRowMetaSegments`) folds it
 * in for the caption, but the spec names only these three fields as
 * searchable. Reads the RAW `locationText`, not the meta line's cleaned-up
 * segment — a stripped postal code or clamped breadcrumb must never make an
 * otherwise-matching role searchable-but-invisible.
 */
export function jobMatchesQuery(job: PublicJob, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [decodeText(job.title), locationText(job), prettyEnum(job.experience_level)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * Collapses re-synced duplicate postings — the same role ingested twice
 * under a second id — to a single row, keyed on the same text the row
 * itself displays (title + location) via `decodeText`/`locationText`, so
 * two rows a visitor can't tell apart never render as two. Order-preserving
 * (keeps the first occurrence), matching `dedupeNewsArticles`'s convention
 * for the same class of problem. The key is deliberately narrower than full
 * row equality: a minor field like `work_type` differing between the pair
 * (observed live — one copy discloses "Onsite", the duplicate omits it)
 * does not exempt them from collapsing.
 */
export function collapseDuplicatePostings(jobs: PublicJob[]): PublicJob[] {
  const seen = new Set<string>();
  const out: PublicJob[] = [];
  for (const job of jobs) {
    const key = `${decodeText(job.title).trim().toLowerCase()}\u0000${locationText(job).trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
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
  companySlug,
  companyName,
  openCountLabel,
  searchesPartialWindow,
  jobsSearchUrl,
  now,
}: {
  jobs: PublicJob[];
  companyDomain: string;
  /** For the zero-roles empty state's follow CTA (`CompanyFollowControl`). */
  companySlug: string;
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
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  // Collapsed once, up front — every downstream count, search, and render
  // reads this set, so "how many roles" can't disagree with "how many rows".
  const deduped = useMemo(() => collapseDuplicatePostings(jobs), [jobs]);
  const matched = hasQuery ? deduped.filter((job) => jobMatchesQuery(job, trimmedQuery)) : deduped;
  const displayed = matched.slice(0, ROLES_PREVIEW);

  const detailScrollRef = useRef<HTMLDivElement>(null);

  const handleOpenRelated = useCallback(
    async (jobId: string, directJob?: PublicJob) => {
      if (directJob) {
        setSelectedJob(directJob);
        detailScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const found = jobs.find((j) => j.id === jobId);
      if (found) {
        setSelectedJob(found);
        detailScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      try {
        setLoadingJobId(jobId);
        const fetched = await getJobByIdAction(jobId);
        if (fetched) {
          setSelectedJob(fetched);
          detailScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          toast.error("Could not load job details");
        }
      } catch {
        toast.error("Could not load job details");
      } finally {
        setLoadingJobId(null);
      }
    },
    [jobs],
  );

  return (
    <section data-testid="company-role-search">
      <h2 className="mb-4 flex items-baseline justify-between font-display text-[20px] font-semibold">
        Open roles
        {deduped.length > 0 && (
          <span className="text-xs font-normal text-muted-foreground" aria-live="polite">
            {roleCountLabel(displayed.length, matched.length, hasQuery, openCountLabel)}
          </span>
        )}
      </h2>

      {deduped.length > 0 && (
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
              Searching the {deduped.length} most recent roles —{" "}
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
          <div className="border border-border bg-card px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No open roles match &ldquo;{trimmedQuery}&rdquo;.
            </p>
            <Link href={jobsSearchUrl} className="mt-2 inline-block text-sm text-brand hover:underline">
              Search all jobs at {companyName} →
            </Link>
          </div>
        ) : (
          // No live roles at all (not just no search matches) — a dead-end
          // sentence with nothing to do next is strictly worse than turning
          // the visitor into a follower, since that's the one action this
          // page can actually offer them right now.
          <div className="border border-border bg-card px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No open roles right now. Follow {companyName} — we&apos;ll email you when they post.
            </p>
            <div className="mt-4 flex justify-center">
              <CompanyFollowControl domain={companyDomain} slug={companySlug} displayName={companyName} variant="primary" className="items-center" />
            </div>
          </div>
        )
      ) : (
        <ul className="space-y-2.5">
          {displayed.map((job) => {
            const meta = companyRowMetaSegments(job);
            // Exception-only status: the routine "clear, currently checked"
            // state renders no line at all (see `rowExceptionMeta`'s doc) —
            // only stale-clear/caution/likely_ghost verdicts show up here.
            const exception = rowExceptionMeta(job, now);
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => setSelectedJob(job)}
                  className="w-full text-left flex items-center gap-4 border border-border bg-card px-5 py-4 transition-all hover:border-border-strong hover:bg-chip/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[17px] font-semibold text-foreground group-hover:text-brand transition-colors">
                      {decodeText(job.title)}
                    </div>
                    {meta.length > 0 && (
                      <div className="mt-1 text-[14px] text-muted-foreground">
                        {meta.map((segment, i) => (
                          <span key={i}>
                            {i > 0 && <span className="mx-1 text-muted-foreground/60" aria-hidden>·</span>}
                            <span className={segment.emphasis ? "font-semibold text-foreground" : undefined}>
                              {segment.text}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                    {exception && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        ● {exception.label}
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
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 border border-border bg-card p-6">
          <div>
            <h3 className="font-display text-[18px] font-semibold text-foreground">
              Explore all open roles at {companyName}
            </h3>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              Screened for postings that aren&apos;t really hiring, plus freshness and verified salary transparency.
            </p>
          </div>
          <Button asChild variant="brand" size="lg" className="h-11 px-6 font-semibold shrink-0">
            <Link href={jobsSearchUrl}>
              View all {openCountLabel} jobs →
            </Link>
          </Button>
        </div>
      )}

      {/* Job detail sheet — same chrome/props contract as /jobs mobile detail (SERP). */}
      <Sheet open={Boolean(selectedJob)} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <SheetContent
          side="bottom"
          hideCloseButton
          overlayClassName="bg-[rgba(18,21,26,0.42)]"
          className="left-1/2 flex max-h-[min(88dvh,760px)] w-full max-w-[720px] -translate-x-1/2 flex-col overflow-hidden rounded-t-[18px] border border-border border-b-0 p-0 shadow-[var(--shadow-overlay)] data-[state=open]:duration-[var(--transition-panel)] data-[state=closed]:duration-[var(--transition-panel)]"
        >
          <div className="shrink-0 border-b border-border">
            <div className="flex justify-center pb-1 pt-2.5" aria-hidden="true">
              <span className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
            </div>
            <div className="flex items-center gap-2 px-4 pb-3">
              <div className="min-w-0 flex-1">
                {selectedJob ? (
                  <>
                    <p className="truncate text-base font-semibold tracking-[-0.03em] text-foreground">
                      {decodeText(selectedJob.title)}
                    </p>
                    <p className="truncate text-[13px] text-muted-foreground">
                      {displayCompanyBrand(selectedJob.company, selectedJob.company_domain, selectedJob.title)}
                    </p>
                  </>
                ) : (
                  <p className="truncate text-base font-semibold text-foreground">Job details</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setSelectedJob(null)}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none text-faint transition-opacity hover:opacity-80"
              >
                ×
              </button>
            </div>
          </div>
          <SheetTitle className="sr-only">
            {selectedJob
              ? `${decodeText(selectedJob.title)} at ${displayCompanyBrand(selectedJob.company, selectedJob.company_domain, selectedJob.title)}`
              : "Job details"}
          </SheetTitle>
          <div
            ref={detailScrollRef}
            data-testid="mobile-detail-scroller"
            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom,0px)] custom-scrollbar"
          >
            {selectedJob && (
              <PublicJobDetail
                job={selectedJob}
                onOpenRelated={handleOpenRelated}
                collapseDescription={false}
                detailClassName="border-0 bg-transparent shadow-none"
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
