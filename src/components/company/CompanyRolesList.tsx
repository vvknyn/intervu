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
}: {
  roles: PublicJob[];
  jobsSearchUrl: string;
}) {
  if (roles.length === 0) return null;

  return (
    <section data-testid="company-roles" className="mt-8 border-t border-foreground pt-6">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Live roles
        </span>
        <Link href={jobsSearchUrl} className="text-xs text-foreground underline underline-offset-2">
          View all in search →
        </Link>
      </div>

      <ul className="mt-4 space-y-2">
        {roles.map((job) => {
          const ghost = ghostMetaFor(job.ghost_badge, false);
          return (
            <li key={job.id}>
              <Link
                href={jobsSearchUrl}
                className="flex items-center justify-between gap-4 rounded-lg border border-foreground/10 px-4 py-3 text-[13.5px] transition-colors hover:border-foreground/30"
              >
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{decodeText(job.title)}</div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">{roleMeta(job)}</div>
                </div>
                {ghost && (
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px]", ghost.cls)}>
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
