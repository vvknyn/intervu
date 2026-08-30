"use client";

import { useEffect } from "react";
import { BRAND_MARK_PATHS, BRAND_MARK_STROKE_WIDTH, BRAND_MARK_VIEWBOX } from "@/components/brand/BrandMark";
import { EMAIL_COLORS } from "@/lib/email/templates/palette";

/**
 * Top-level error boundary — only fires when the root layout itself throws.
 * It REPLACES the root layout, so it must render its own <html>/<body> and
 * cannot rely on globals.css component classes being applied. Keep it minimal,
 * self-contained, and inline-styled, but still on-brand (indigo).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO(observability): forward to Sentry once wired up.
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          background: "#f8f8fb",
          color: "#15161b",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <svg viewBox={BRAND_MARK_VIEWBOX} width="44" height="44" fill="none" aria-hidden="true">
          {BRAND_MARK_PATHS.map((d) => (
            <path
              key={d}
              d={d}
              stroke={EMAIL_COLORS.brand}
              strokeWidth={BRAND_MARK_STROKE_WIDTH}
              strokeLinecap="butt"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
          Velai hit a snag
        </h1>
        <p style={{ maxWidth: "28rem", color: "#565b69", margin: 0 }}>
          The app failed to start this view. Please reload the page.
        </p>
        <button
          onClick={() => reset()}
          style={{
            marginTop: "0.5rem",
            border: "none",
            borderRadius: "0.5rem",
            background: EMAIL_COLORS.brand,
            color: "#fff",
            padding: "0.65rem 1.25rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
