# Favicon + mechanical SEO — fix report (local verification, port 3010)

## Gaps fixed (before → after, curl proof)
1. `/favicon.ico` 404 → 200, `image/x-icon`. `file`: "MS Windows icon resource - 3 icons, 16x16 ... 32x32 ... [48x48]".
2. `/apple-touch-icon.png` 404 → 200, 180×180 (`sips -g pixelWidth`: 180).
3. `/manifest.webmanifest` 404 → 200, valid JSON (name/short_name/theme_color `#12151a`/icons 192+512).
4. `icon.png` 388×388 → 32×32; added `icon-192.png`/`icon-512.png` (both 200). `icon.svg` unchanged (already 200).
5. Per-page canonical/og:url: verified on `/about`, `/privacy`, `/pricing`, `/connect`, `/trends`, `/research/ghost-jobs` — each shows exact `<title>page · Intervu</title>`, `<link rel="canonical" href="https://intervu.cc/<path>">`, distinct `og:title`/`og:url` (previously all inherited homepage `/` + generic "Intervu").
6. `sitemap.xml`: `/login` removed (grep confirms absent, 451 `<url>` entries remain). `/connect` kept (real product page), `/yours` never added (empty shell for crawlers). `robots.txt` already had `Sitemap: https://intervu.cc/sitemap.xml` — no change needed.

## Favicon generation
Source: `src/app/icon.svg` (self-contained, dark bg baked in — good for apple-touch-icon, which needs a background). `sharp` was already in `node_modules` — used it for all PNG rasterization. Wrote `scripts/generate-favicons.mjs` (reusable, re-run on any brand-mark change) which renders 16/32/48/180/192/512 PNGs and hand-assembles `favicon.ico` as a PNG-embedded ICO container (valid ICONDIR/ICONDIRENTRY binary format, no new dep). Outputs verified via `file`: favicon.ico = ICO w/ embedded PNGs; icon.png/apple-touch-icon.png/icon-192/icon-512 = plain PNG at declared sizes.
Wiring: `src/app/favicon.ico` + `src/app/icon.png` (Next file convention, auto-served/linked) + `src/app/manifest.ts` (Next convention → `/manifest.webmanifest`) + `metadata.icons.apple` in root layout pointing at `public/apple-touch-icon.png` (needed as a literal static file since Apple's HTML-independent fallback fetch bypasses the `app/apple-icon.png` convention's generated path).

## Canonical/og chokepoint
`metadataBase` was already set on root layout (pre-existing). Generalized the `jobs/layout.tsx` (#145) pattern into `src/lib/seo/page-metadata.ts::canonicalMetadata(path, title, description)` — one helper producing `alternates.canonical` + `openGraph`/`twitter` title/url/description, spread into each page's existing `metadata` object. Wired into about/privacy/terms/pricing/connect/contact/trends(`generateMetadata`)/research/ghost-jobs. `jobs/page.tsx` untouched (owned by a concurrent agent); `/stories` skipped — it's login-gated, not public content, and was never in the sitemap.

## Structured data
Added `buildOrganizationJsonLd()` (name/url/logo=`/icon-512.png`) to `src/lib/seo/jsonld.ts`; root layout now renders one `<script type="application/ld+json">` with `[WebSite, Organization]` (WebSite/SearchAction pre-existed from a prior pass). Verified via curl on `/about`.

## Verification
`npx tsc --noEmit`: clean. `next build`: succeeds, all routes generate. `npx tsx --test tests/unit/guest-copy-jargon.test.ts tests/unit/landing-intent.test.ts`: 4/4 pass. Server started/killed on 3010 only.

## JobPosting (report-only, not built)
Jobs live behind `?job=` query params — no crawlable per-job URL exists, so there's zero JobPosting schema.org markup and zero Google Jobs surface for a 1.7M-listing corpus, the single biggest SEO lever on the table. This needs SSR'd per-job routes (`/jobs/[id]` or similar), a real dedup/canonical strategy (many listings are near-duplicates across boards), and expiry handling (Google penalizes stale JobPosting markup) — a real project, not a mechanical fix, and out of scope here.

## Concerns
`app/icon.png`/`public/intervu-logo.png` were byte-identical (388×388) pre-fix; I only touched the former (favicon tag source) — `intervu-logo.png` is unreferenced in `src/` and left as-is (out of scope, no favicon role).
