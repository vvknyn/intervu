import { ImageResponse } from "next/og";
import { BRAND_MARK_BRACKETS, BRAND_MARK_DOT, BRAND_MARK_DOT_FILL, BRAND_MARK_VIEWBOX } from "@/components/brand/BrandMark";

// Route segment config + image metadata (Next reads these by convention).
export const runtime = "edge";
export const alt = "Intervu — your job application workspace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Branded OpenGraph/Twitter card: indigo gradient field, the Intervu
 * bracket-gate mark, and the product name + tagline. Generated at the edge by
 * next/og's ImageResponse.
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
          background:
            "linear-gradient(135deg, #4338CA 0%, #4F46E5 45%, #6366F1 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 112,
            height: 112,
            borderRadius: 28,
            background: "rgba(255,255,255,0.14)",
          }}
        >
          <svg viewBox={BRAND_MARK_VIEWBOX} width="72" height="72">
            {BRAND_MARK_BRACKETS.map((d) => (
              <path key={d} d={d} fill="#ffffff" />
            ))}
            <circle cx={BRAND_MARK_DOT.cx} cy={BRAND_MARK_DOT.cy} r={BRAND_MARK_DOT.r} fill={BRAND_MARK_DOT_FILL} />
          </svg>
        </div>
        <div
          style={{
            marginTop: 48,
            fontSize: 88,
            fontWeight: 700,
            letterSpacing: "-0.03em",
          }}
        >
          Intervu
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 38,
            fontWeight: 400,
            color: "rgba(255,255,255,0.88)",
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
