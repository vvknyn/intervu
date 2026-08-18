"use client";

import { useEffect } from "react";
import { BRAND_MARK_BRACKETS, BRAND_MARK_DOT, BRAND_MARK_DOT_FILL, BRAND_MARK_VIEWBOX } from "@/components/brand/BrandMark";

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
        <svg viewBox={BRAND_MARK_VIEWBOX} width="44" height="44" aria-hidden="true">
          {BRAND_MARK_BRACKETS.map((d) => (
            <path key={d} d={d} fill="#4F46E5" />
          ))}
          <circle cx={BRAND_MARK_DOT.cx} cy={BRAND_MARK_DOT.cy} r={BRAND_MARK_DOT.r} fill={BRAND_MARK_DOT_FILL} />
        </svg>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
          Intervu hit a snag
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
            background: "#4F46E5",
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
