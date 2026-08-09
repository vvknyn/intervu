import Link from "next/link";
import { jobCompanyHref } from "@/lib/companies/paths";
import { titleCaseDisplay } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * The `/jobs/[slug]` page's highest-position original content (spec §6.2) —
 * immediately under the `<h1>`, ahead of `JobDetail`'s own ghost-verdict
 * module. Concrete counts only: when the company aggregate fields are
 * absent this renders nothing — a vaguer adjective must never stand in for
 * a missing number. Reuses `jobCompanyHref`, the same company-link builder
 * `JobDetail` itself uses, so this can never disagree with it about where
 * "this company's page" lives.
 */
export function EmployerTrackRecord({ job }: { job: PublicJob }) {
    if (typeof job.company_opened_90d !== "number" || typeof job.company_closed_90d !== "number" || !job.company) {
        return null;
    }

    const opened = job.company_opened_90d;
    const closed = job.company_closed_90d;
    const company = titleCaseDisplay(job.company);

    return (
        <section data-testid="employer-track-record" className="mb-4 mt-2 text-sm text-muted-foreground">
            <p>
                {company} opened {opened.toLocaleString()} {opened === 1 ? "role" : "roles"} in the last 90 days and
                closed {closed.toLocaleString()}.
            </p>
            <Link href={jobCompanyHref(company, job.company_domain)} className="mt-1 inline-block text-brand hover:underline">
                See {company}&rsquo;s full hiring record →
            </Link>
        </section>
    );
}
