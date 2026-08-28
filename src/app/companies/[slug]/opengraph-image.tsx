import { buildPageOgImage, OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/lib/og/page-card";
import { companyFromSlug } from "@/lib/companies/paths";
import { SITE_NAME } from "@/lib/seo/constants";

export const runtime = "edge";
export const alt = `${SITE_NAME} — company hiring truth`;
export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_CONTENT_TYPE;

// Same build-safety posture as the page itself (see page.tsx's comment):
// `companyFromSlug` is a pure decode, no Meili round trip, so this card can
// never fail the build the way a fetchCompanyProfile() call could.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = companyFromSlug(slug);
  return buildPageOgImage(name, "Hiring truth");
}
