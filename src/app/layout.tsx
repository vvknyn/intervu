import type { Metadata } from "next";
import { Libre_Franklin, Source_Sans_3, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./elite-signal.css";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { TopBar } from "@/components/layout/TopBar";
import { SearchDockProvider } from "@/components/layout/SearchDockContext";
import { Footer } from "@/components/layout/Footer";
import { PostHogProvider } from "@/components/providers/PostHogProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TourProvider } from "@/components/tour/TourProvider";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { TourTrigger } from "@/components/tour/TourTrigger";
import { getSiteUrl, LANDING_TITLE, SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME } from "@/lib/seo/constants";
import {
  buildJobSearchFaqJsonLd,
  buildOrganizationJsonLd,
  buildWebApplicationJsonLd,
  buildWebsiteJsonLd,
  serializeJsonLd,
} from "@/lib/seo/jsonld";
import { Toaster } from "@/lib/toast";
import { CursorFabricBackground } from "@/components/ui/CursorFabricBackground";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";

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
 * - Libre Franklin (display): an American gothic with warmth in it. Carries
 *   headline voice without the geometric coolness of the startup defaults.
 * - Source Sans 3 (body/UI): humanist, built for interfaces, holds up at the
 *   small sizes this UI leans on, and ships true tabular figures — which is
 *   what lets data columns line up WITHOUT conscripting a monospace face.
 * - JetBrains Mono (mono): kept, but demoted to literal code — shell commands
 *   and MCP keys in Settings/Connect, where looking technical is correct
 *   because the content IS technical. It is no longer the voice of the site.
 */
const display = Libre_Franklin({
  variable: "--font-display-face",
  subsets: ["latin"],
  display: "swap",
});

const sans = Source_Sans_3({
  variable: "--font-sans-face",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  display: "swap",
});

const SITE_TITLE = SITE_NAME;
// Fallback for any route that doesn't set its own `metadata` — `/jobs`
// (a "use client" page, which can't export metadata of its own) is the
// main consumer today.
/** Site-wide guest meta strings live in @/lib/seo/constants — see SITE_DESCRIPTION and LANDING_*. */

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: LANDING_TITLE,
    template: "%s · Intervu",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_TITLE,
  keywords: SITE_KEYWORDS,
  authors: [{ name: "Intervu", url: getSiteUrl() }],
  creator: "Intervu",
  publisher: "Intervu",
  category: "Job Search & Careers",
  classification: "Job Search, Employment, Careers, Indeed Alternative, LinkedIn Alternative",
  referrer: "origin-when-cross-origin",
  // No blanket canonical here — a route without its own metadata (like
  // `/jobs`, a "use client" page that can't export one) is better served
  // by no canonical tag than a wrong one pointing at `/`. `/` sets its own
  // in src/app/page.tsx.
  // No `images` array here — leaving it unset lets Next's file-based
  // convention (opengraph-image.tsx, 1200x630) fill it in, and lets every
  // route with its own generator (jobs/[slug], co/[slug], companies/[slug],
  // pricing, trends) override it per-route. An explicit `images` entry here
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
    // File-convention icons (favicon.ico, icon.png, icon.svg) are picked up
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
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Dark-mode FOUC guard (2026-08-15 mode toggle) — a synchronous
            script in <head> blocks first paint until it runs, so a returning
            dark-mode visitor never flashes the light surface. Mirrors
            ThemeProvider's own read of the same "intervu-mode" key; that
            provider's MutationObserver re-applies brand accent colors
            whenever this class flips, so this script only sets the class. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("intervu-mode")==="dark"){document.documentElement.classList.add("dark");}}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${display.variable} ${sans.variable} ${mono.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        {/* Site-wide WebSite graph (SearchAction, for a sitelinks search box
            pointed at intervu's own jobs search) + Organization graph (name,
            url, logo). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(rootJsonLd) }}
        />
        <AuthKitProvider>
        <PostHogProvider>
          <ThemeProvider>
            <CursorFabricBackground />
            <TourProvider>
              {/* Wraps BOTH the header and the page: /jobs publishes its search
                  summary here once its own search box scrolls away, and TopBar
                  renders it. Siblings can't share state without this. */}
              <SearchDockProvider>
              <TopBar />
              {children}
              </SearchDockProvider>
              <Footer />
              <MobileTabBar />
              <TourOverlay />
              <TourTrigger />
              <Toaster />
            </TourProvider>
          </ThemeProvider>
        </PostHogProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}
