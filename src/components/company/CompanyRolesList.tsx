import Link from "next/link";
import { decodeText, rowExceptionMeta } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { companyRowMetaSegments } from "@/lib/presentation";
import { cn } from "@/lib/utils";

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
    <section data-testid="company-roles" className="mt-8 border-t border-foreground pt-6">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">
          Live roles
        </span>
        <Link href={jobsSearchUrl} className="text-xs text-foreground underline underline-offset-2">
          View all in search →
        </Link>
      </div>

      <ul className="mt-4 space-y-2">
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
                className="flex items-center justify-between gap-4 border border-foreground px-4 py-3 text-sm transition-colors hover:border-foreground"
              >
                <div className="min-w-0">
                  <div className="text-foreground">{decodeText(job.title)}</div>
                  {meta.length > 0 && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
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
                </div>
                {ghost && (
                  <span className={cn("shrink-0 px-2 py-0.5 text-xs", ghost.cls)}>
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
