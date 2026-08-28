import { buildPageOgImage, OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/lib/og/page-card";
import { getJobById } from "@/lib/jobs/get-job";
import { parseJobSlug } from "@/lib/jobs/job-slug";
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

  // The eyebrow is the reason someone forwards the link: the employer's own
  // 90-day track record when we have it. Never invent a number — fall back
  // to the company name, and only to a generic label when even that is absent.
  const eyebrow =
    job && job.company_opened_90d != null && job.company_closed_90d != null && job.company
      ? `${job.company} · opened ${job.company_opened_90d}, closed ${job.company_closed_90d} in 90d`
      : (job?.company ?? "Live jobs, checked against companies' own career pages");

  return buildPageOgImage(job?.title ?? SITE_NAME, eyebrow);
}
