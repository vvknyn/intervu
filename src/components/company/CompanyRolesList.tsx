import Link from "next/link";
import { CompanyJobRowLink } from "@/components/company/CompanyJobRow";
import type { PublicJob } from "@/lib/jobs/types";

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
    <section data-testid="company-roles" className="mt-4 border-t border-border pt-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-foreground">Live roles</span>
        <Link href={jobsSearchUrl} className="text-xs text-brand hover:underline">
          View all in search
        </Link>
      </div>

      <ul className="divide-y divide-border border-t border-border">
        {roles.map((job) => (
          <li key={job.id}>
            <CompanyJobRowLink job={job} now={now} href={jobsSearchUrl} />
          </li>
        ))}
      </ul>
    </section>
  );
}
