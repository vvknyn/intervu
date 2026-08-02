import { ImageResponse } from "next/og";

/**
 * Shared OpenGraph/Twitter card shape for interior pages (company profiles,
 * trends) — one render function so the three `opengraph-image.tsx` routes
 * that use it (co/[slug], companies/[slug], trends) can't drift into three
 * near-identical layouts. The root `/opengraph-image.tsx` (indigo gradient +
 * V-mark) is a separate, older card kept as-is; this one is the current
 * identity: dark ink ground, wordmark, a signal-green accent rule, and
 * page-specific title text. Edge runtime, so no custom font loading — a bold
 * system sans reads fine at this size.
 */

export const OG_IMAGE_SIZE = { width: 1200, height: 630 };
export const OG_IMAGE_CONTENT_TYPE = "image/png";

// Same literal values as globals.css's dark-theme tokens (--background,
// --foreground) and the brand green (--brand, light theme — the one
// "signal-green #0D6E56" the product is anchored to) — hardcoded because
// ImageResponse's Satori renderer can't resolve CSS custom properties from
// an external stylesheet.
const INK = "#0F1216";
const FOREGROUND = "#ECEEF2";
const MUTED = "rgba(236,238,242,0.6)";
const SIGNAL_GREEN = "#0D6E56";

/** The brand's V-mark — same path used by the root OG image and the
 *  error/not-found pages, so this card reads as the same product. */
function BrandMark() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 40,
        height: 40,
        borderRadius: 10,
        background: "rgba(13,110,86,0.18)",
      }}
    >
      <svg viewBox="0 0 40 40" width={22} height={22}>
        <path
          d="M9 13 L19 28 L31 7"
          fill="none"
          stroke={SIGNAL_GREEN}
          strokeWidth={4.4}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
    </div>
  );
}

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
          padding: "80px",
          background: INK,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BrandMark />
          <span
            style={{
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: FOREGROUND,
            }}
          >
            intervu
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 1000 }}>
          <div style={{ width: 64, height: 4, background: SIGNAL_GREEN, marginBottom: 28 }} />
          {eyebrow && (
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: MUTED,
                marginBottom: 16,
              }}
            >
              {eyebrow}
            </div>
          )}
          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              color: FOREGROUND,
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
