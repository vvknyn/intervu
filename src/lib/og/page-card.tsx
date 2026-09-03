import { ImageResponse } from "next/og";
import { BRAND_MARK_BRACKETS, BRAND_MARK_DOT, BRAND_MARK_DOT_FILL, BRAND_MARK_VIEWBOX } from "@/components/brand/BrandMark";
import { EMAIL_COLORS } from "@/lib/email/templates/palette";
import { SITE_NAME } from "@/lib/seo/constants";

/**
 * Shared OpenGraph/Twitter card shape for interior pages (trends, jobs,
 * companies/[slug], jobs/[slug], co/[slug]) — one render function so those
 * routes can't drift into near-identical layouts. Same grammar as the root
 * `/opengraph-image.tsx` card: white ground, ink type, Klein lockup — this
 * one adds a page-specific title + meta line below it. Edge runtime, so no
 * custom font loading — a system sans reads fine at this size.
 */

export const OG_IMAGE_SIZE = { width: 1200, height: 630 };
export const OG_IMAGE_CONTENT_TYPE = "image/png";

// OG-card lockup scale — deliberately separate from BRAND_LOCKUP_MARK_PX /
// BRAND_LOCKUP_WORDMARK_PX (those are the 28px in-app header size; a
// 1200x630 card needs a bigger mark, not the header's).
const OG_MARK_PX = 48;

export function buildPageOgImage(title: string, eyebrow?: string): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          background: "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg viewBox={BRAND_MARK_VIEWBOX} width={OG_MARK_PX} height={OG_MARK_PX}>
            {BRAND_MARK_BRACKETS.map((d) => (
              <path key={d} d={d} fill={EMAIL_COLORS.brand} />
            ))}
            <circle cx={BRAND_MARK_DOT.cx} cy={BRAND_MARK_DOT.cy} r={BRAND_MARK_DOT.r} fill={BRAND_MARK_DOT_FILL} />
          </svg>
          {/* Wordmark parity with BrandMark.tsx's on-page lockup: same
              rulebook-sanctioned exception (uppercase, weight 700, tight
              tracking) — just inline styles since Satori can't read
              Tailwind classes. */}
          <span
            style={{
              fontSize: OG_MARK_PX,
              fontWeight: 700,
              letterSpacing: "-0.025em",
              // design-lint-allow
              textTransform: "uppercase",
              color: EMAIL_COLORS.brand,
            }}
          >
            {SITE_NAME}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 1000 }}>
          {eyebrow && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 28,
                  lineHeight: "36px",
                  fontWeight: 400,
                  color: "#525252",
                  marginBottom: 20,
                }}
              >
                {eyebrow}
              </div>
              <div style={{ display: "flex", width: "100%", height: 1, background: "#E0E0E0", marginBottom: 24 }} />
            </div>
          )}
          <div
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
              fontSize: 56,
              lineHeight: "64px",
              fontWeight: 600,
              color: "#0A0A0A",
            }}
          >
            {title}
          </div>
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE },
  );
}
