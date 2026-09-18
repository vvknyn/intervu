import Link from "next/link";
import { decodeText, rowExceptionMeta, titleCaseDisplay } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { companyRowMetaSegments } from "@/lib/presentation";

/**
 * This company's live-postings list. Every row links back to the main jobs
 * search pre-filled with this company's name (`jobsSearchUrl`, built by the
 * page from `companyPagePath`'s reverse — the actual name, not the slug) —
 * this page states facts about the company, the full interactive search
 * (filters, apply links, job detail) stays on `/`.
 */
export function CompanyRolesList({
  roles,
  jobsSearchUrl,
  now,
}: {
  roles: PublicJob[];
  jobsSearchUrl: string;
  /** Threaded from the page (one clock per render pass, house pattern) so the
   *  staleness read below is pure and testable — never Date.now() in render. */
  now: number;
}) {
  if (roles.length === 0) return null;

  return (
    <section data-testid="company-roles" className="mt-8 border-t border-border pt-6">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">
          Live roles
        </span>
        <Link href={jobsSearchUrl} className="text-sm text-brand hover:underline">
          View all in search
        </Link>
      </div>

      {/* Row anatomy (design-language.md §4), reduced to a single grid
          level — same adaptation as CompanyRoleSearch: every row here is
          the ONE company already shown above, so there's no per-row logo
          for a leading `auto` tile, and the divider runs full-width on the
          row itself rather than on an inner wrapper. This section sits
          inside the page's own padded content column, not a full-bleed
          list surface, so rows take their horizontal margin from that
          ambient padding rather than `--list-inset`. */}
      <ul className="mt-4">
        {roles.map((job) => {
          // Exception-only: a "clear" verdict whose backing check has gone
          // stale still renders STALE_CLEAR_META's neutral "Not recently
          // verified" here exactly as it does on the SERP row and detail
          // banner (rowExceptionMeta wraps the shared ghostMetaFor
          // chokepoint), but the routine clear-and-current state — the
          // default, nothing-to-flag verdict — renders no pill at all.
          const ghost = rowExceptionMeta(job, now);
          const meta = companyRowMetaSegments(job);
          return (
            <li key={job.id}>
              <Link
                href={jobsSearchUrl}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border pt-4 pb-4 transition-colors hover:bg-muted"
              >
                <div className="min-w-0">
                  <div className="text-base font-semibold leading-snug text-foreground line-clamp-2">
                    {titleCaseDisplay(decodeText(job.title))}
                  </div>
                  {meta.length > 0 && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {meta.map((segment, i) => (
                        <span key={i}>
                          {i > 0 && <span className="mx-1" aria-hidden>·</span>}
                          {segment.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {ghost && (
                  <span className="mono-data shrink-0 self-start text-xs leading-none text-muted-foreground">
                    {ghost.label}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
