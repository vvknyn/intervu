import { ImageResponse } from "next/og";

// Route segment config + image metadata (Next reads these by convention).
export const runtime = "edge";
export const alt = "Intervu pricing — no subscription, buy credits when you're hunting";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * /pricing's own OG card — typographic only, ink background with the
 * signal-green brand accent carrying the price point. Deliberately its own
 * creative (not the root card's indigo gradient + V-mark): this route's
 * story is "no subscription", not the product pitch.
 */
export default function PricingOpengraphImage() {
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
          background: "#0A0A0A",
          color: "#F5F5F5",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#0D6E56",
          }}
        >
          Intervu
        </div>
        <div
          style={{
            marginTop: 28,
            display: "flex",
            fontSize: 84,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.08,
            maxWidth: 980,
          }}
        >
          Pricing — no subscription.
        </div>
        <div
          style={{
            marginTop: 24,
            display: "flex",
            fontSize: 36,
            fontWeight: 400,
            color: "rgba(245,245,245,0.72)",
            maxWidth: 880,
            lineHeight: 1.3,
          }}
        >
          Buy credits when you&apos;re hunting. Search stays free.
        </div>
      </div>
    ),
    { ...size },
  );
}
