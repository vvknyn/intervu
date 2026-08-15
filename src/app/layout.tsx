import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Sans, IBM_Plex_Mono, Spline_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import "./elite-signal.css";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { TopBar } from "@/components/layout/TopBar";
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

// Frozen UI typeface pair (see globals.css --font-sans/--font-mono/
// --font-display). DM Sans covers UI, wordmark, and headings; IBM Plex Mono
// carries numbers, timestamps, verdicts, and micro-labels.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/** Elite mock surfaces only (scoped via `.elite-signal` in elite-signal.css). */
const bricolage = Bricolage_Grotesque({
  variable: "--font-elite-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const splineSans = Spline_Sans({
  variable: "--font-elite-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-elite-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_TITLE,
    title: LANDING_TITLE,
    description: SITE_DESCRIPTION,
    url: getSiteUrl(),
    images: [
      {
        url: `${getSiteUrl()}/icon-512.png`,
        width: 512,
        height: 512,
        alt: "Intervu - Verified Live Job Search",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: LANDING_TITLE,
    description: SITE_DESCRIPTION,
    images: [`${getSiteUrl()}/icon-512.png`],
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
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${ibmPlexMono.variable} ${bricolage.variable} ${splineSans.variable} ${splineMono.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        {/* Site-wide WebSite graph (SearchAction, for a sitelinks search box
            pointed at intervu's own jobs search) + Organization graph (name,
            url, logo). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(rootJsonLd) }}
        />
        {/* Paper-light only (2026-08-14 reskin): nothing adds `.dark` at
            runtime anymore, so no pre-paint theme script is needed — SSR and
            client both render the light token palette. */}
        <PostHogProvider>
          <ThemeProvider>
            <TourProvider>
              <TopBar />
              {children}
              <Footer />
              <MobileTabBar />
              <TourOverlay />
              <TourTrigger />
              <Toaster />
            </TourProvider>
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
