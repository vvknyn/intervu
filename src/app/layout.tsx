import type { Metadata } from "next";
import { Suspense } from "react";
import { Libre_Franklin, Source_Sans_3, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { TopBar } from "@/components/layout/TopBar";
import { OnboardingRoot } from "@/components/onboarding/OnboardingRoot";
import { SearchDockProvider } from "@/components/layout/SearchDockContext";
import { Footer } from "@/components/layout/Footer";
import { IconDefaultsProvider } from "@/components/providers/IconDefaultsProvider";
import { DeferredPostHogProvider } from "@/components/providers/DeferredPostHogProvider";
import { DeferredAuthKitProvider } from "@/components/providers/DeferredAuthKitProvider";
import { PostAuthSessionRefresh } from "@/components/auth/PostAuthSessionRefresh";
import { IdleDeferredWidgets } from "@/components/providers/IdleDeferredWidgets";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TourProvider } from "@/components/tour/TourProvider";
import { getSiteUrl, LANDING_TITLE, SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME } from "@/lib/seo/constants";
import {
  buildJobSearchFaqJsonLd,
  buildOrganizationJsonLd,
  buildWebApplicationJsonLd,
  buildWebsiteJsonLd,
  serializeJsonLd,
} from "@/lib/seo/jsonld";

/**
 * Three faces, each named for the ROLE it plays rather than the vendor that
 * happens to fill it. The previous pair was declared as `--font-inter` and
 * `--font-jetbrains-mono`, which meant swapping a typeface required renaming
 * a variable in every consumer — the naming itself made the design system
 * expensive to change, so it never changed.
 *
 * Why these, replacing Inter + JetBrains Mono everywhere (2026-08-17): the
 * site reads as built-for-engineers to people outside tech, which is a
 * problem when the corpus is genuinely multi-vertical (nursing and physical
 * therapy each match as many postings as software engineering). Inter is the
 * default startup sans and JetBrains Mono is literally an IDE typeface; a
 * nurse reading a page set in them correctly concludes it is not for them.
 *
 * - Source Sans 3 (body/UI): Concept A canonical sans — static 400/500/600 cuts
 *   (500 is the button face, globals.css `--control-weight`) from
 *   next/font (not the default variable axis bundle) so small semibold labels keep
 *   the face without the exaggerated post-`t` sidebearing the variable asset showed.
 * - Libre Franklin (display face variable): kept for intentional OG use only;
 *   `font-display` consumers resolve to `--font-sans`, not this face.
 * - JetBrains Mono (mono): kept, but demoted to literal code — shell commands
 *   and MCP keys in Settings/Connect, where looking technical is correct
 *   because the content IS technical. It is no longer the voice of the site.
 */
const display = Libre_Franklin({
  variable: "--font-display-face",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  weight: ["600", "700"],
});

const sans = Source_Sans_3({
  variable: "--font-sans-face",
  subsets: ["latin"],
  // optional: hero/subline use metric-matched fallback on first paint (LCP).
  display: "optional",
  weight: ["400", "500", "600"],
  preload: true,
  adjustFontFallback: true,
});

const mono = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  display: "swap",
  weight: ["400"],
  preload: false,
  adjustFontFallback: false,
});

const SITE_TITLE = SITE_NAME;
// Fallback for any route that doesn't set its own `metadata`. `/jobs` sets its
// own (lib/seo/jobs-metadata.ts), so this is no longer its page-level copy.
/** Site-wide guest meta strings live in @/lib/seo/constants — see SITE_DESCRIPTION and LANDING_*. */

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: LANDING_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_TITLE,
  keywords: SITE_KEYWORDS,
  authors: [{ name: SITE_NAME, url: getSiteUrl() }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "Job Search & Careers",
  classification: "Job Search, Employment, Careers, Indeed Alternative, LinkedIn Alternative",
  referrer: "origin-when-cross-origin",
  // No blanket canonical here — a route without its own metadata is better
  // served by no canonical tag than a wrong one. Indexable pages name theirs
  // through lib/seo/indexability.ts (`/` redirects to `/jobs`, which does).
  // No `images` array here — leaving it unset lets Next's file-based
  // convention (opengraph-image.tsx, 1200x630) fill it in, and lets every
  // route with its own generator (jobs/[slug], co/[slug], companies/[slug],
  // trends) override it per-route. An explicit `images` entry here
  // previously WON over all of those, so the 512x512 square app icon shipped
  // as the og:image on every route instead (2026-08-24 fix).
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_TITLE,
    title: LANDING_TITLE,
    description: SITE_DESCRIPTION,
    url: getSiteUrl(),
  },
  twitter: {
    card: "summary_large_image",
    title: LANDING_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    // File-convention icons (favicon.ico, icon.png) are picked up
    // automatically from src/app/ — only the apple-touch icon needs an
    // explicit entry, since it also has to exist as a literal
    // /apple-touch-icon.png (public/) for iOS's own HTML-independent
    // fallback fetch, which the app/apple-icon.* file convention wouldn't
    // serve at that exact path.
    apple: "/apple-touch-icon.png",
  },
};

// Rendered as a single script tag (array of graphs) below — covers site-wide
// WebSite (SearchAction), Organization (name/url/logo), WebApplication,
// and high-intent FAQ structured data.
const faqJsonLd = buildJobSearchFaqJsonLd();
const rootJsonLd = [
  buildWebsiteJsonLd(),
  buildOrganizationJsonLd(),
  buildWebApplicationJsonLd(),
  ...(faqJsonLd ? [faqJsonLd] : []),
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Charcoal first paint — offline document reload before CSS bundle. */}
        <style
          dangerouslySetInnerHTML={{
            __html: "html,body{background:#0B0D12}",
          }}
        />
        {/* Dark-only FOUC guard — stamp `.dark` before first paint; no light path. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.documentElement.classList.add("dark");localStorage.setItem("intervu-mode","dark");}catch(e){document.documentElement.classList.add("dark");}})();`,
          }}
        />
      </head>
      <body
        className={`${display.variable} ${sans.variable} ${mono.variable} antialiased bg-background text-foreground min-h-screen flex flex-col`}
        suppressHydrationWarning
      >
        {/* Site-wide WebSite graph (SearchAction, for a sitelinks search box
            pointed at intervu's own jobs search) + Organization graph (name,
            url, logo). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(rootJsonLd) }}
        />
        <DeferredAuthKitProvider>
        <PostAuthSessionRefresh />
        <DeferredPostHogProvider>
          <ThemeProvider>
            <IconDefaultsProvider>
            <TourProvider>
              {/* First focusable element on every page (keyboard-only rule:
                  standard "skip to main content" pattern). Same visually-hidden-
                  until-focus classes as /jobs's own "Skip to results" link
                  (src/app/jobs/page.tsx) — that one stays too, it targets a
                  narrower destination inside this same <main>; two skip links
                  is the standard pattern, not a duplicate. */}
              <a
                href="#main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-20 focus:z-[var(--z-skip-link)] focus:border focus:border-foreground focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
              >
                Skip to main content
              </a>
              {/* Wraps BOTH the header and the page: /jobs publishes its search
                  summary here once its own search box scrolls away, and TopBar
                  renders it. Siblings can't share state without this. */}
              <SearchDockProvider>
              <TopBar />
              {/* A new account's setup sheet;
                  nothing for anyone else (components/onboarding/). */}
              <OnboardingRoot />
              {/* The one <main> landmark per page (standard-pattern rule) —
                  every page used to own its own <main>, so a page with a
                  selected job (two h1-bearing regions) rendered two, and ~19
                  pages rendered none. Page-level `<main>`s were converted to
                  `<div>` (classes untouched) so this is the only one; `tabIndex=
                  {-1}` lets the skip link above actually move focus here. */}
              <main id="main" tabIndex={-1} className="flex-1 flex flex-col">
              {children}
              </main>
              </SearchDockProvider>
              <Footer />
              <MobileTabBar />
              <IdleDeferredWidgets />
            </TourProvider>
            </IconDefaultsProvider>
          </ThemeProvider>
        </DeferredPostHogProvider>
        </DeferredAuthKitProvider>
      </body>
    </html>
  );
}
