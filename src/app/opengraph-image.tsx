import { ImageResponse } from "next/og";
import { LOCKED_MARK_DATA_URI } from "@/lib/brand/locked-mark-data-uri";
import { EMAIL_COLORS } from "@/lib/email/templates/palette";
import { SITE_NAME } from "@/lib/seo/constants";

// Route segment config + image metadata (Next reads these by convention).
export const runtime = "edge";
export const alt = `${SITE_NAME} — your job application workspace`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Branded OpenGraph/Twitter card: white field, ink type, and the locked
 * Velai product mark (soft paper card, navy brackets, one bigger live dot).
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOCKED_MARK_DATA_URI}
            width={64}
            height={64}
            alt=""
            style={{ borderRadius: 12 }}
          />
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
