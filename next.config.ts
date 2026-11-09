import type { NextConfig } from "next";
import { applyWorkOsRedirectUriBridge } from "./src/lib/auth/workos-redirect-uri-env";
import {
  CANADA_CAREER_REDIRECT_DESTINATION,
  REMOVED_CANADA_CAREER_SLUGS,
} from "./src/lib/seo/canada-career-redirects";
import { SIGNED_OUT_SHORT_REDIRECTS } from "./src/lib/seo/signed-out-short-routes";

// AuthKit only reads NEXT_PUBLIC_WORKOS_REDIRECT_URI; bridge before any route loads.
applyWorkOsRedirectUriBridge();

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
 * script-src third-party origins = every origin src/ loads a script from:
 * challenges.cloudflare.com (Turnstile api.js, components/ui/turnstile-widget.tsx).
 * tests/unit/csp-script-src.test.ts scans src/ and fails when one is missing.
 *
 * Shipped in Report-Only mode first so a missed directive surfaces as a violation
 * report instead of breaking runtime. Reports go to {@link CSP_REPORT_PATH}
 * (src/app/api/csp-report/route.ts, one `[csp-report]` log line each): a
 * report-only policy nobody can read is not a trial run.
 * TODO(security): once the `[csp-report]` lines show no violation of the policy
 * below in prod, tighten it (drop 'unsafe-eval', enumerate connect-src hosts) and
 * promote the script/style/connect rules into {@link ENFORCED_POLICY}.
 */
export const CSP_REPORT_PATH = "/api/csp-report";
/** Name of the Reporting API endpoint (`Reporting-Endpoints` header) the policy's `report-to` points at. */
export const CSP_REPORT_ENDPOINT = "csp-endpoint";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https:",
  "frame-src 'self' https://*.firebaseapp.com https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `report-uri ${CSP_REPORT_PATH}`,
  `report-to ${CSP_REPORT_ENDPOINT}`,
].join("; ");

/**
 * The ENFORCED policy: the directives that cannot break a page because nothing
 * in src/ uses what they forbid (checked by tests/unit/csp-enforced-images.test.ts,
 * which fails when a `<object>`, `<embed>` or `<base>` appears).
 *
 * - `img-src`: the browser refuses any image that is not our own origin, an
 *   inline data: image or a blob: URL, whatever the code asks for. Closes the
 *   remote-image class (a tracking pixel or a third-party avatar is a request to
 *   someone else that carries the visitor's IP and, absent a Referrer-Policy, the
 *   page they were on).
 * - `object-src 'none'`: no plugin content (`<object>`, `<embed>`), the vector a
 *   script-src bypass would otherwise use.
 * - `base-uri 'self'`: an injected `<base href>` cannot re-point every relative
 *   link and script on the page.
 * - `frame-ancestors 'none'`: no site may frame this one (the same rule as
 *   `X-Frame-Options: DENY`, in the header modern browsers prefer).
 *
 * Deliberately not enforced here: script-src, style-src, connect-src and
 * form-action. They stay in the report-only policy above until the collected
 * reports are clean; enforcing them blind would break the page they guard.
 * Both headers apply to every response, so the stricter of the two wins per directive.
 */
export const ENFORCED_POLICY = [
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Cache-Control for the un-hashed images, fonts and video served from public/.
 * Next already sends `public, max-age=31536000, immutable` for the content-hashed
 * files under /_next/static (and cannot be overridden there); everything in
 * public/ keeps its plain name, and Next answers those with `max-age=0`, so every
 * visit re-asks for every logo and blog picture. These files are replaced by
 * renaming, not in place, so a month is safe; `immutable` and a year are not,
 * because a file replaced in place would stay stale in every browser that has it.
 * public/ocr is left out on purpose: it is copied from node_modules at build time
 * and its .js and .wasm must change together.
 */
export const PUBLIC_MEDIA_CACHE_CONTROL = "public, max-age=2592000, stale-while-revalidate=604800";
export const PUBLIC_MEDIA_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "woff", "woff2", "ttf", "otf", "mp4", "webm"] as const;
/**
 * Every path ending in one of those extensions EXCEPT under /_next/ and /logos/.
 * Next's own content-hashed files under /_next/ (fonts, images, scripts) are
 * `immutable` for a year, and a rule that matched them would shorten that to a
 * month (measured: the hashed font under /_next/static/media went from immutable
 * to 30 days). /logos/<domain>.png is a route (lib/companies/logo-proxy.ts) that
 * sets its own Cache-Control: a header from this file REPLACES a route's own, on
 * its 404 and 502 too (measured), so the rule would keep a logo the upstream did
 * not have, or an upstream error, in every cache for a month instead of an hour.
 */
export const PUBLIC_MEDIA_SOURCE = `/((?!_next/|logos/).*)\\.(${PUBLIC_MEDIA_EXTENSIONS.join("|")})`;

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
  { key: "Reporting-Endpoints", value: `${CSP_REPORT_ENDPOINT}="${CSP_REPORT_PATH}"` },
  { key: "Content-Security-Policy-Report-Only", value: CONTENT_SECURITY_POLICY },
  { key: "Content-Security-Policy", value: ENFORCED_POLICY },
];

const nextConfig: NextConfig = {
  // Contabo/Docker: emit .next/standalone for a slim runtime image (see Dockerfile).
  output: "standalone",
  // `next dev` allows localhost by default but treats 127.0.0.1 as a
  // different host and 403s module scripts (Origin: http://127.0.0.1:…).
  allowedDevOrigins: ["127.0.0.1"],
  // Don't advertise the framework.
  poweredByHeader: false,
  reactStrictMode: true,
  // No external image hosts are used today (no next/image remote src). Kept empty
  // and explicit so adding one is a deliberate, reviewable change.
  images: {
    remotePatterns: [],
  },
  // Next 16 defaults to Turbopack for `next dev` / `next build`. The browser
  // alias is Turbopack's form of the webpack fallbacks below (still used with
  // `--webpack`): transformers.js must see an empty object for fs/path, not
  // `undefined` — see src/lib/local-ai/empty-node-builtin.ts.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/local-ai/empty-node-builtin.ts" },
      path: { browser: "./src/lib/local-ai/empty-node-builtin.ts" },
    },
  },
  webpack(config, { isServer }) {
    // Transformers.js + onnxruntime-web reference Node builtins in browser builds.
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        // Apply the security headers to every route.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // Un-hashed public/ media: a month, not `max-age=0` (see PUBLIC_MEDIA_CACHE_CONTROL).
        source: PUBLIC_MEDIA_SOURCE,
        headers: [{ key: "Cache-Control", value: PUBLIC_MEDIA_CACHE_CONTROL }],
      },
      {
        // public/install (generated by scripts/prebuild-openclaw.mjs) is
        // extensionless so `curl -fsSL <origin>/install | bash`
        // works — Next's static mime lookup can't infer a type from the
        // name, so force one explicitly rather than let it fall back to
        // application/octet-stream.
        source: "/install",
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
      },
    ];
  },
  async redirects() {
    return [
      // Humans who type the short MCP URL land on the pairing page. NOT
      // permanent: /mcp may become the real endpoint later, and the agent
      // endpoint itself stays /api/mcp — MCP clients exact-match the pasted
      // URL against the server's resource metadata, so marketing copy must
      // say /api/mcp until that metadata changes with it.
      {
        source: "/mcp",
        destination: "/connect",
        permanent: false,
      },
      // /agents was the agent-MCP marketing page before /connect became the
      // canonical human landing spot for the feature (front-of-house
      // consolidation, 2026-08-02) — permanent since, unlike /mcp above,
      // nothing about this route is still undecided. Query params pass
      // through automatically.
      {
        source: "/agents",
        destination: "/connect",
        permanent: true,
      },
      // `/` itself now unconditionally redirects to `/jobs` (src/app/page.tsx,
      // "the front door IS the job board") via an in-app redirect() call —
      // but that call targets a bare path and drops query params. A deep
      // link with a search query (`?q=...`, e.g. an old bookmark or shared
      // URL) still means "show me results," so this rule intercepts it
      // first, at the routing layer, and forwards `q` (and any other query
      // params) through to `/jobs` before `/`'s own redirect runs and loses
      // them. Permanent (308) like page.tsx's own redirect: both are the
      // same move of the front door to /jobs.
      {
        source: "/",
        has: [{ type: "query", key: "q" }],
        destination: "/jobs",
        permanent: true,
      },
      // The applications tracker became the pursuit list (jobs-first-bloom
      // PR 2). Query params (e.g. ?view=new) pass through automatically.
      {
        source: "/applications",
        destination: "/yours",
        permanent: true,
      },
      // Library folded into Stories (jobs-first-bloom PR 3). Query params
      // (e.g. ?tab=sources) pass through automatically.
      {
        source: "/library",
        destination: "/stories",
        permanent: true,
      },
      // Prep surface removed (2026-08-02 product decision — the user's own AI
      // does prep now; intervu is corpus + browse + pair + tracker). Query
      // params (e.g. ?company=&position=) pass through automatically.
      {
        source: "/prep",
        destination: "/jobs",
        permanent: true,
      },
      // /dashboard was a bare `redirect("/prep")` page with no other content
      // — removed alongside /prep rather than left pointing at a dead route.
      {
        source: "/dashboard",
        destination: "/jobs",
        permanent: true,
      },
      // Resume building/tailoring removed (2026-08-03 — "no AI on website"
      // doctrine, part 2). All AI resume work now happens through the
      // user's own agent (MCP/WhatsApp); /yours is where a signed-in user
      // lands to see their tracked applications and (separately) their base
      // resume in Settings.
      {
        source: "/resume-builder",
        destination: "/yours",
        permanent: true,
      },
      {
        source: "/resume-tailor",
        destination: "/yours",
        permanent: true,
      },
      ...REMOVED_CANADA_CAREER_SLUGS.map((slug) => ({
        source: `/careers/${slug}`,
        destination: CANADA_CAREER_REDIRECT_DESTINATION,
        permanent: true,
      })),
      // `/packs` and `/apply` never had pages. 307 (not 308) so a later real
      // surface can take the path without a cached forever-redirect.
      ...SIGNED_OUT_SHORT_REDIRECTS.map((rule) => ({
        source: rule.source,
        destination: rule.destination,
        permanent: false,
      })),
    ];
  },
};

export default nextConfig;
