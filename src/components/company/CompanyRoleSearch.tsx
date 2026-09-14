"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { fetchResumeData } from "@/actions/resume";
import { getJobByIdAction } from "@/actions/jobs";
import { CompanyFollowControl } from "@/components/companies/CompanyFollowControl";
import { MatchChip } from "@/components/jobs/MatchChip";
import { PublicJobDetail } from "@/components/jobs/PublicJobDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { decodeText, displayCompanyBrand, locationText, prettyEnum, rowExceptionMeta, shortDate, titleCaseDisplay } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { scoreJobAgainstResume, type MatchScore } from "@/lib/match/score";
import { companyRowMetaSegments } from "@/lib/presentation";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { toast } from "@/lib/toast";
import type { ResumeData } from "@/types/resume";

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

  // Match chip — same résumé read path as `/jobs` and the job-detail header
  // (`fetchResumeData` → `resumeIsUsable`, see PublicJobDetail.tsx) so this
  // page's chip can never disagree with the SERP/detail chip for the same
  // signed-in user. Fetched ONCE per page (keyed on auth state), not per row.
  const [user, setUser] = useState<User | null>(() => getCurrentUser());
  useEffect(() => onAuthChange(setUser), []);

  const [resume, setResume] = useState<ResumeData | null>(null);
  const [resumeAsOfDate, setResumeAsOfDate] = useState<string | null>(null);
  useEffect(() => {
    if (!user) {
      setResume(null);
      setResumeAsOfDate(null);
      return;
    }
    let cancelled = false;
    fetchResumeData()
      .then(({ data, updatedAt }) => {
        if (cancelled || !data || !resumeIsUsable(data)) return;
        setResume(data);
        const ms = updatedAt ? Date.parse(updatedAt) : NaN;
        setResumeAsOfDate(Number.isFinite(ms) ? shortDate(ms).toLowerCase() : null);
      })
      .catch(() => {
        /* no résumé on file — no chip, no nagging */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // The one scoring function (`scoreJobAgainstResume`, lib/match/score.ts),
  // computed once per résumé/job-set, keyed by job id — same map idiom as
  // `/jobs` (SERP). `null` (no résumé) short-circuits to no map at all.
  const matchScores = useMemo(() => {
    if (!resume) return null;
    const map = new Map<string, MatchScore | null>();
    for (const job of jobs) map.set(job.id, scoreJobAgainstResume(resume, job));
    return map;
  }, [resume, jobs]);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  // `jobs` arrives already deduped — `getCompanyPageData` (get-company.ts)
  // runs `collapseDuplicatePostings` once, server-side, so every downstream
  // count, search, and render reads the SAME set. This component trusts that
  // contract rather than re-deriving its own view of it.
  const matched = hasQuery ? jobs.filter((job) => jobMatchesQuery(job, trimmedQuery)) : jobs;
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
      <h2 className="mb-4 flex items-baseline justify-between font-display text-lg font-semibold">
        Open roles
        {jobs.length > 0 && (
          <span className="text-sm font-normal text-muted-foreground" aria-live="polite">
            {roleCountLabel(displayed.length, matched.length, hasQuery, openCountLabel)}
          </span>
        )}
      </h2>

      {jobs.length > 0 && (
        <div className="mb-4">
          <label htmlFor="company-role-search" className="sr-only">
            Search {companyName}&apos;s open roles by title, location, or level
          </label>
          <div className="relative">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="company-role-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder={`Search ${companyName}'s open roles…`}
              className="h-10 pl-9"
            />
          </div>
          {searchesPartialWindow && hasQuery && (
            <p className="mt-2 text-xs text-muted-foreground">
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
          <div className="border border-border bg-card px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No open roles match &ldquo;{trimmedQuery}&rdquo;.
            </p>
            <Link href={jobsSearchUrl} className="mt-2 inline-block text-sm text-brand hover:underline">
              Search all jobs at {companyName}
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
        <ul className="divide-y divide-border border-t border-border">
          {displayed.map((job) => {
            const meta = companyRowMetaSegments(job);
            // Exception-only status: the routine "clear, currently checked"
            // state renders no line at all (see `rowExceptionMeta`'s doc) —
            // only stale-clear/caution/likely_ghost verdicts show up here.
            const exception = rowExceptionMeta(job, now);
            const matchScore = matchScores?.get(job.id) ?? null;
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => setSelectedJob(job)}
                  className="w-full text-left flex items-center gap-4 px-3 py-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 truncate text-base font-semibold text-foreground transition-colors group-hover:text-brand">
                        {titleCaseDisplay(decodeText(job.title))}
                      </div>
                      {matchScore && (
                        <span className="shrink-0">
                          <MatchChip score={matchScore} asOfDate={resumeAsOfDate} jobId={job.id} />
                        </span>
                      )}
                    </div>
                    {meta.length > 0 && (
                      // Pay leads this line same as everywhere else it's
                      // sourced from `companyRowMetaSegments`, but a role row
                      // reads as one plain secondary caption here — never
                      // bolded, per the rulebook's "pay NOT bold" rule.
                      <div className="mt-1 truncate text-sm text-muted-foreground">
                        {meta.map((segment, i) => (
                          <span key={i}>
                            {i > 0 && <span className="mx-1" aria-hidden>·</span>}
                            {segment.text}
                          </span>
                        ))}
                      </div>
                    )}
                    {exception && (
                      <div className="mt-1.5 text-xs text-muted-foreground">{exception.label}</div>
                    )}
                  </div>
                  <span className="shrink-0 text-sm text-brand" aria-hidden>
                    View role
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
            <h3 className="font-display text-base font-semibold text-foreground">
              Explore all open roles at {companyName}
            </h3>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              Screened for postings that aren&apos;t really hiring, plus freshness and verified salary transparency.
            </p>
          </div>
          <Button asChild variant="brand" size="lg" className="shrink-0">
            <Link href={jobsSearchUrl}>
              View all {openCountLabel} jobs
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
          className="left-1/2 flex max-h-[min(88dvh,760px)] w-full max-w-[720px] -translate-x-1/2 flex-col overflow-hidden border border-border border-b-0 p-0 data-[state=open]:duration-[var(--transition-panel)] data-[state=closed]:duration-[var(--transition-panel)]"
        >
          <div className="shrink-0 border-b border-border">
            <div className="flex justify-center pb-1 pt-2.5" aria-hidden="true">
              <span className="h-1.5 w-10 rounded-none bg-border" />
            </div>
            <div className="flex items-center gap-2 px-4 pb-3">
              <div className="min-w-0 flex-1">
                {selectedJob ? (
                  <>
                    <p className="truncate text-base font-semibold text-foreground">
                      {decodeText(selectedJob.title)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
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
                className="flex h-11 w-11 shrink-0 items-center justify-center text-faint transition-opacity hover:opacity-80"
              >
                <X size={16} weight="bold" aria-hidden />
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
                source="co"
                onOpenRelated={handleOpenRelated}
                collapseDescription={false}
                detailClassName="border-0 bg-transparent"
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
