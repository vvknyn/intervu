import { buildPageOgImage, OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/lib/og/page-card";
import { SITE_NAME } from "@/lib/seo/constants";

export const runtime = "edge";
export const alt = `${SITE_NAME} — market trends`;
export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_CONTENT_TYPE;

export default function Image() {
  return buildPageOgImage("Market trends", "Live hiring data");
}
