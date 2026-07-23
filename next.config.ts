import type { NextConfig } from "next";

/**
 * Pragmatic Content-Security-Policy for the Intervu stack.
 *
 * The app talks to Firebase (Auth + Firestore), OpenRouter, Groq, a self-hosted
 * Meilisearch box, and loads Google Fonts. 'unsafe-inline'/'unsafe-eval' are kept
 * for script-src because Next's inline bootstrap + the no-flash dark-mode inline
 * script in layout.tsx require them, and several deps (jspdf/html2canvas/monaco)
 * use eval-ish codegen. connect-src is intentionally broad (https:) so BYOK keys
 * can hit any provider host the user configures without a redeploy.
 *
 * Shipped in Report-Only mode first so a missed directive surfaces in the browser
 * console as a violation report instead of breaking runtime.
 * TODO(security): tighten (drop 'unsafe-eval', enumerate connect-src hosts, add a
 * report-uri/Reporting-API endpoint) and promote to the enforcing
 * `Content-Security-Policy` header once violations are confirmed clean in prod.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https:",
  "frame-src 'self' https://*.firebaseapp.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  {
    // Force HTTPS for 2 years incl. subdomains; eligible for the HSTS preload list.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Deny camera/geolocation outright; allow mic only to self (in-browser STT).
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=()",
  },
  // Report-Only for now — see CONTENT_SECURITY_POLICY note above.
  { key: "Content-Security-Policy-Report-Only", value: CONTENT_SECURITY_POLICY },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework.
  poweredByHeader: false,
  reactStrictMode: true,
  // No external image hosts are used today (no next/image remote src). Kept empty
  // and explicit so adding one is a deliberate, reviewable change.
  images: {
    remotePatterns: [],
  },
  async headers() {
    return [
      {
        // Apply the security headers to every route.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  async redirects() {
    return [
      // Jobs flipped to root (jobs-first-bloom PR 1). Query params (e.g.
      // ?job=<id>) pass through automatically — Next preserves them on 301s.
      {
        source: "/jobs",
        destination: "/",
        permanent: true,
      },
      // The applications tracker became the pursuit list (jobs-first-bloom
      // PR 2). Query params (e.g. ?view=new) pass through automatically.
      {
        source: "/applications",
        destination: "/yours",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
