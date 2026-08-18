import Link from "next/link";
import { decodeText, ghostMetaFor, locationText, prettyEnum, salaryText } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

function roleMeta(job: PublicJob): string {
  return [locationText(job), salaryText(job), prettyEnum(job.experience_level)].filter(Boolean).join(" · ");
}

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
        <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Live roles
        </span>
        <Link href={jobsSearchUrl} className="text-xs text-foreground underline underline-offset-2">
          View all in search →
        </Link>
      </div>

      <ul className="mt-4 space-y-2">
        {roles.map((job) => {
          // Real staleness, not a hardcoded `false`: a "clear" verdict whose
          // backing check has gone stale renders STALE_CLEAR_META's neutral
          // "Not recently verified" here exactly as it does on the SERP row
          // and detail banner — ghostMetaFor is the shared chokepoint, and
          // this was the one caller bypassing it.
          const ghost = ghostMetaFor(job, now);
          return (
            <li key={job.id}>
              <Link
                href={jobsSearchUrl}
                className="flex items-center justify-between gap-4 border border-foreground/10 px-4 py-3 text-[13.5px] transition-colors hover:border-foreground/30"
              >
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{decodeText(job.title)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{roleMeta(job)}</div>
                </div>
                {ghost && (
                  <span className={cn("shrink-0 px-2 py-0.5 text-[11px]", ghost.cls)}>
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
