import { buildPageOgImage, OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/lib/og/page-card";
import { getCompanyPageData } from "@/lib/companies/get-company";

export const runtime = "edge";
export const alt = "Intervu — company hiring truth";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getCompanyPageData(slug);
  return buildPageOgImage(data?.name ?? "Company", "Hiring truth");
}
