import { buildPageOgImage, OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/lib/og/page-card";
import { getCompanyPageData } from "@/lib/companies/get-company";
import { SITE_NAME } from "@/lib/seo/constants";

// nodejs, not edge: getCompanyPageData now reaches getCompanyExhaust ->
// getExhaustPg, which imports the `pg` driver (raw TCP, native bindings) —
// something the Edge Runtime sandbox cannot load at all, edge crashes on
// import alone. This route never renders exhaust data into the image (only
// `data.name`), so nothing gated is exposed by the switch.
export const runtime = "nodejs";
export const alt = `${SITE_NAME} — company hiring record`;
export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getCompanyPageData(slug);
  return buildPageOgImage(data?.name ?? "Company", "Hiring record");
}
