import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono, Plus_Jakarta_Sans, Schibsted_Grotesk, Spline_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import "./elite-signal.css";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { TopBar } from "@/components/layout/TopBar";
import { Footer } from "@/components/layout/Footer";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TourProvider } from "@/components/tour/TourProvider";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { TourTrigger } from "@/components/tour/TourTrigger";
import { SITE_NAME, SITE_URL } from "@/lib/seo/constants";
import { buildWebsiteJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { Toaster } from "@/lib/toast";

// Soft Signal typeface pair (see globals.css --font-sans/--font-mono/
// --font-display). Plus Jakarta Sans covers UI, wordmark, and headings;
// JetBrains Mono carries numbers, timestamps, verdicts, and micro-labels.
const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Visual-identity pass (2026-08-01): Schibsted Grotesk leads --font-sans/
// --font-display (globals.css), with Plus Jakarta Sans kept as the next
// fallback rather than removed — see globals.css's font token comment.
const schibstedGrotesk = Schibsted_Grotesk({
  variable: "--font-schibsted-grotesk",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
// main consumer today. `/` (the automation-first front door) overrides
// this with its own metadata in src/app/page.tsx.
const SITE_DESCRIPTION = "Search live roles — flagged for ghost-job risk before you spend time on them.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Intervu — Find jobs",
    template: "%s · Intervu",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_TITLE,
  keywords: [
    "resume builder",
    "job application tracker",
    "cover letter",
    "job search",
  ],
  // No blanket canonical here — a route without its own metadata (like
  // `/jobs`, a "use client" page that can't export one) is better served
  // by no canonical tag than a wrong one pointing at `/`. `/` sets its own
  // in src/app/page.tsx.
  openGraph: {
    type: "website",
    siteName: SITE_TITLE,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

const websiteJsonLd = buildWebsiteJsonLd();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${plusJakarta.variable} ${schibstedGrotesk.variable} ${jetbrainsMono.variable} ${bricolage.variable} ${splineSans.variable} ${splineMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {/* Site-wide WebSite graph + SearchAction, so search engines can offer
            a sitelinks search box pointed at intervu's own jobs search. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd) }}
        />
        {/* Apply persisted dark mode before paint (no flash). Default = light. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('intervu-dark')==='1'){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
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
      </body>
    </html>
  );
}
