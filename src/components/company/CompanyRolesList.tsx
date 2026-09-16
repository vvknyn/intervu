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

      <ul className="mt-4 divide-y divide-border border-t border-border">
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
                className="flex items-center justify-between gap-4 px-3 py-4 transition-colors hover:bg-muted"
              >
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground">{titleCaseDisplay(decodeText(job.title))}</div>
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
                  <span className="shrink-0 text-xs text-muted-foreground">{ghost.label}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
