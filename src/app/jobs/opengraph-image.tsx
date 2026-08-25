import { buildPageOgImage, OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/lib/og/page-card";

// /jobs is the front door `/` redirects to (see app/page.tsx) — `/` itself
// never actually renders (it always calls `redirect()`), so its own
// app/opengraph-image.tsx never reaches a crawler. Without this file, /jobs
// inherited no image at all once its layout's hardcoded `images` array was
// removed (2026-08-24): Next's file-based image convention is resolved
// per-segment, not by walking up to the nearest ancestor that has one, once
// a segment declares its own `openGraph` object. Giving /jobs its own
// generator — same shared card as co/[slug], companies/[slug], trends —
// is what actually makes it get an image again.
export const runtime = "edge";
export const alt = "Intervu — live jobs from company career pages";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_CONTENT_TYPE;

export default function Image() {
  return buildPageOgImage("Live jobs, straight from the source", "Verified & ghost-screened");
}
