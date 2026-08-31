import { displayCompanyBrand } from "@/lib/jobs/presentation";
import { jobShareUrl } from "@/lib/jobs/share-url";

export interface ReportListingJob {
  id: string;
  title: string;
  company: string | null;
  company_domain: string | null;
  apply_url: string | null;
}

/** Public company label for report events — name when known, else domain. */
export function reportListingCompany(
  job: Pick<ReportListingJob, "company" | "company_domain" | "title">,
): string {
  return (
    displayCompanyBrand(job.company, job.company_domain, job.title) ||
    job.company_domain?.trim() ||
    job.company?.trim() ||
    "unknown"
  );
}

export function buildReportListingPayload(job: ReportListingJob, origin: string) {
  const company = reportListingCompany(job);
  const detailUrl = origin ? jobShareUrl(origin, job) : "";
  const job_url = detailUrl || job.apply_url?.trim() || "";

  return {
    register: {
      reported_job_id: job.id,
      reported_job_title: job.title,
      reported_company: company,
    },
    capture: {
      job_id: job.id,
      job_title: job.title,
      company,
      job_url,
    },
  } as const;
}
