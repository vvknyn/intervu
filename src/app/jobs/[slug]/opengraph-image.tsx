import { buildPageOgImage, OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/lib/og/page-card";
import { getJobById } from "@/lib/jobs/get-job";
import { parseJobSlug } from "@/lib/jobs/job-slug";
import { decodeText, displayCompanyBrand, titleCaseDisplay } from "@/lib/jobs/presentation";
import { SITE_NAME } from "@/lib/seo/constants";

export const runtime = "edge";
export const alt = `${SITE_NAME} — job listing`;
export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_CONTENT_TYPE;
export const revalidate = 86400;

// Same shared card as co/[slug] and companies/[slug] so every interior page
// reads as one product — do not fork a second ImageResponse tree here.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = parseJobSlug(slug);
  const job = id ? await getJobById(id) : null;

  // The eyebrow is the company name, or a generic label when even that is absent.
  // No opened/closed numbers: a count baked into a share image is cached by social sites and goes stale.
  // `company` is cleaned through the same chain the job page itself uses
  // (`displayCompanyFor` in ./page.tsx) — the index carries the ATS-stated
  // raw name, so an uncleaned `job.company` here would put "REQ123 Acme" in
  // a social-preview card nobody else on the route renders raw.
  const company = job ? displayCompanyBrand(job.company, job.company_domain, job.title) || null : null;
  const eyebrow = company ?? "Live jobs, checked against companies' own career pages";

  const jobTitle = job ? titleCaseDisplay(decodeText(job.title)) : null;
  return buildPageOgImage(jobTitle ?? SITE_NAME, eyebrow);
}
