"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { fetchResumeData } from "@/actions/resume";
import { getJobByIdAction } from "@/actions/jobs";
import { CompanyFollowControl } from "@/components/companies/CompanyFollowControl";
import { KpiStat } from "@/components/jobs/JobDetail";
import { MatchChip } from "@/components/jobs/MatchChip";
import { PublicJobDetail } from "@/components/jobs/PublicJobDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetHandle, SheetTitle } from "@/components/ui/sheet";
import { SectionTitle, SubTitle } from "@/components/ui/heading";
import type { CompanyRoleStat } from "@/lib/companies/presentation";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { decodeText, displayCompanyBrand, locationText, postedAgeShort, prettyEnum, rowExceptionMeta, shortDate, titleCaseDisplay } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { GHOST_RESEARCH_HREF } from "@/lib/marketing-stats";
import { matchBand, scoreJobAgainstResume, type MatchScore } from "@/lib/match/score";
import { companyRowMetaSegments } from "@/lib/presentation";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { storedResumeData } from "@/lib/resume/stored-resume-data";
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
 * (`locationText`/`levelText`), so a match is always on text the visitor can
 * actually see next to the input, not a raw field they can't. Deliberately
 * excludes salary — the row's meta line (`companyRowMetaSegments`) folds it
 * in for the caption, but the spec names only these three fields as
 * searchable. Reads the RAW `locationText`, not the meta line's cleaned-up
 * segment — a stripped postal code or clamped breadcrumb must never make an
 * otherwise-matching role searchable-but-invisible. The level is matched as
 * the row says it (`levelText`, "Mid-level"). Every word of the query must
 * appear somewhere, in any order, so "senior engineer" finds "Senior
 * Controls Engineer".
 */
export function jobMatchesQuery(job: PublicJob, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [decodeText(job.title), locationText(job), levelText(job.experience_level) ?? ""]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** A role's level as the row's meta line says it. Levels the corpus doesn't
 *  know ("unknown", empty) say nothing. */
const LEVEL_TEXT: Record<string, string> = {
  entry: "Entry level",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  executive: "Executive",
};

export function levelText(level: string | null | undefined): string | null {
  if (!level) return null;
  return LEVEL_TEXT[level.toLowerCase()] ?? (prettyEnum(level) || null);
}

/**
 * The résumé's figure for the stat row: strong fits only, the band a visitor
 * can act on first and the one the row chip calls "Strong". Counted over the
 * loaded roles, and said so when those are only the most recent ones.
 */
export function roleFitStat(
  matchScores: ReadonlyMap<string, MatchScore | null> | null,
  loadedCount: number,
  partialWindow: boolean,
): CompanyRoleStat | null {
  if (!matchScores) return null;
  const strong = [...matchScores.values()].filter((m) => m && matchBand(m.total) === "strong").length;
  return partialWindow
    ? { key: "fit", value: String(strong), label: `strong fits among the ${loadedCount} newest` }
    : { key: "fit", value: `${strong} of ${loadedCount}`, label: "strong fit for your résumé" };
}

/** Best fit first once a résumé is scored; unscored roles keep their order
 *  at the end. Without scores, the search's own order. */
export function sortByFit(jobs: PublicJob[], matchScores: ReadonlyMap<string, MatchScore | null> | null): PublicJob[] {
  if (!matchScores) return jobs;
  return [...jobs].sort((a, b) => (matchScores.get(b.id)?.total ?? -1) - (matchScores.get(a.id)?.total ?? -1));
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
  stats = [],
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
  /** The stat row above the list (`buildCompanyRoleStats`). The résumé fit
   *  count joins it here because only this component holds the résumé. */
  stats?: CompanyRoleStat[];
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
      .then(({ data: stored, text, updatedAt }) => {
        const data = storedResumeData(stored, text);
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

  const fitStat = roleFitStat(matchScores, jobs.length, searchesPartialWindow);
  const allStats = fitStat ? [fitStat, ...stats] : stats;

  // `jobs` arrives already deduped — `getCompanyPageData` (get-company.ts)
  // runs `collapseDuplicatePostings` once, server-side, so every downstream
  // count, search, and render reads the SAME set. This component trusts that
  // contract rather than re-deriving its own view of it.
  const matched = sortByFit(hasQuery ? jobs.filter((job) => jobMatchesQuery(job, trimmedQuery)) : jobs, matchScores);
  const displayed = matched.slice(0, ROLES_PREVIEW);

  const detailScrollRef = useRef<HTMLDivElement>(null);
  // The row that opened the sheet, so closing it puts keyboard focus back
  // where the visitor was instead of at the top of the page.
  const openerRef = useRef<HTMLButtonElement | null>(null);

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
      {allStats.length > 0 && (
        <div data-testid="company-role-stats" className="mb-8 flex flex-wrap gap-x-8 gap-y-4">
          {allStats.map((stat) => (
            <KpiStat key={stat.key} value={stat.value} label={stat.label} minWidthClassName="min-w-0" />
          ))}
        </div>
      )}
      <SectionTitle className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3">
        Open roles
        {jobs.length > 0 && (
          <span className="text-sm font-normal text-muted-foreground" aria-live="polite">
            {matchScores ? "Best fit first · " : ""}
            {roleCountLabel(displayed.length, matched.length, hasQuery, openCountLabel)}
          </span>
        )}
      </SectionTitle>

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
              className="ctl-lg rounded-ctl border border-border bg-card pl-9 text-base"
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
          <div data-testid="company-roles-empty" className="py-8">
            <p className="text-sm text-foreground">
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
          // page can actually offer them right now. §6 empty state: one
          // next action, "Follow this company".
          <div data-testid="company-roles-empty" className="py-8">
            <p className="text-sm text-foreground">
              No open roles right now. Follow {companyName} and we&apos;ll email you when they post.
            </p>
            <div className="mt-4 flex">
              <CompanyFollowControl domain={companyDomain} slug={companySlug} displayName={companyName} variant="primary" className="items-start" />
            </div>
          </div>
        )
      ) : (
        // Row anatomy (design-language.md §4), reduced to a single grid
        // level — every row here belongs to the ONE company already shown
        // in the page header, so (unlike /jobs) there's no per-row logo to
        // put in a leading `auto` tile. Dropping that tile also means the
        // divider has nothing to inset past, so `border-b` runs full-width
        // on the row itself rather than on an inner wrapper. This section
        // sits inside the page's own padded content column (not a
        // full-bleed list surface like /jobs), so rows take their
        // horizontal margin from that ambient padding — `--list-inset`
        // would double it here, not conform to it.
        <ul>
          {displayed.map((job) => {
            const meta = companyRowMetaSegments(job);
            const level = levelText(job.experience_level);
            // The level follows the pay and comes before the location, the
            // long part a phone cuts, so "at my level?" survives truncation.
            const metaText = meta.map((segment) => segment.text);
            if (level) metaText.splice(meta.filter((segment) => segment.emphasis).length, 0, level);
            const age = postedAgeShort(derivePostedTs(job), now);
            // Exception-only status: the routine "clear, currently checked"
            // state renders no line at all (see `rowExceptionMeta`'s doc) —
            // only stale-clear/caution/likely_ghost verdicts show up here.
            const exception = rowExceptionMeta(job, now);
            const matchScore = matchScores?.get(job.id) ?? null;
            return (
              <li key={job.id}>
                <button
                  type="button"
                  data-testid="company-role-row"
                  onClick={(e) => {
                    openerRef.current = e.currentTarget;
                    setSelectedJob(job);
                  }}
                  // control-scale-allow: full-width list row — its padding is content layout, not a bar control
                  className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border pt-4 pb-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand cursor-pointer"
                >
                  <div className="min-w-0">
                    <span className="inline-flex flex-wrap items-baseline gap-x-2">
                      <span className="min-w-0 text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-brand line-clamp-2">
                        {titleCaseDisplay(decodeText(job.title))}
                      </span>
                      {matchScore && <MatchChip score={matchScore} asOfDate={resumeAsOfDate} jobId={job.id} />}
                    </span>
                    {metaText.length > 0 && (
                      // Pay leads this line same as everywhere else it's
                      // sourced from `companyRowMetaSegments`, but a role row
                      // reads as one plain secondary caption here — never
                      // bolded, per the rulebook's "pay NOT bold" rule.
                      <div className="mt-1 truncate text-sm text-muted-foreground">
                        {metaText.map((text, i) => (
                          <span key={i}>
                            {i > 0 && <span className="mx-1" aria-hidden>·</span>}
                            {text}
                          </span>
                        ))}
                      </div>
                    )}
                    {exception && (
                      <div className="mt-1.5 text-xs text-muted-foreground">{exception.label}</div>
                    )}
                  </div>
                  {/* Row anatomy's right rail (design-language §4): the posting's age. */}
                  <span data-testid="company-role-age" className="mono-data shrink-0 self-start text-xs leading-none text-muted-foreground">
                    {age ?? ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {displayed.length > 0 && (
        <div className="mt-8 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SubTitle>
              Explore all open roles at {companyName}
            </SubTitle>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              Screened for{" "}
              <Link href={GHOST_RESEARCH_HREF} className="underline underline-offset-2 hover:text-foreground">
                postings that aren&apos;t really hiring
              </Link>
              , plus freshness and verified salary transparency.
            </p>
          </div>
          <Button asChild variant="brand" className="shrink-0">
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
          onCloseAutoFocus={(e) => {
            if (!openerRef.current?.isConnected) return;
            e.preventDefault();
            openerRef.current.focus();
          }}
          className="left-1/2 max-h-[min(760px,var(--overlay-max-h))] w-full max-w-180 -translate-x-1/2 overflow-hidden border border-border border-b-0 p-0 data-[state=open]:duration-[var(--transition-panel)] data-[state=closed]:duration-[var(--transition-panel)]"
        >
          <div className="shrink-0 border-b border-border">
            <div className="flex justify-center pb-1 pt-2.5" aria-hidden="true">
              <SheetHandle />
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
                className="ctl-md ctl-button flex ctl-square shrink-0 items-center justify-center text-faint transition-opacity hover:opacity-80"
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
