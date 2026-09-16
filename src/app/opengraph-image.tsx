import { ImageResponse } from "next/og";
import { BRAND_MARK_BRACKETS, BRAND_MARK_DOT, BRAND_MARK_DOT_FILL, BRAND_MARK_VIEWBOX } from "@/components/brand/BrandMark";
import { EMAIL_COLORS } from "@/lib/email/templates/palette";
import { SITE_NAME } from "@/lib/seo/constants";

// Route segment config + image metadata (Next reads these by convention).
export const runtime = "edge";
export const alt = `${SITE_NAME} — your job application workspace`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Branded OpenGraph/Twitter card: white field, ink type, and the Velai
 * mark — same palette as the on-page BrandLockup (Satori can't read CSS
 * vars, so colors come from the same literal-hex sources BrandLockup's
 * dot and the email templates already use, rather than a third copy).
 * Generated at the edge by next/og's ImageResponse.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "96px",
          background: "#FFFFFF",
          color: "#0A0A0A",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <svg viewBox={BRAND_MARK_VIEWBOX} width="64" height="64">
            {BRAND_MARK_BRACKETS.map((d) => (
              <path key={d} d={d} fill={EMAIL_COLORS.brand} />
            ))}
            <circle cx={BRAND_MARK_DOT.cx} cy={BRAND_MARK_DOT.cy} r={BRAND_MARK_DOT.r} fill={BRAND_MARK_DOT_FILL} />
          </svg>
          {/* Wordmark parity with BrandMark.tsx's on-page lockup: same
              rulebook-sanctioned exception (uppercase, weight 700, tight
              tracking) — inline styles, Satori can't read Tailwind classes. */}
          <div
            style={{
              marginLeft: 20,
              fontSize: 64,
              fontWeight: 700,
              letterSpacing: "-0.025em",
              // design-lint-allow
              textTransform: "uppercase",
              color: EMAIL_COLORS.brand,
            }}
          >
            {SITE_NAME}
          </div>
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 38,
            fontWeight: 400,
            color: "#525252",
            maxWidth: 900,
            lineHeight: 1.3,
          }}
        >
          Your job application workspace — resumes, applications, and job tracking
          in one place.
        </div>
      </div>
    ),
    { ...size }
  );
}
