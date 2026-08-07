import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Sans, IBM_Plex_Mono, Spline_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import "./elite-signal.css";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { TopBar } from "@/components/layout/TopBar";
import { Footer } from "@/components/layout/Footer";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TourProvider } from "@/components/tour/TourProvider";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { TourTrigger } from "@/components/tour/TourTrigger";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo/constants";
import { buildWebsiteJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
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
// main consumer today. `/` (the automation-first front door) overrides
// this with its own metadata in src/app/page.tsx.

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
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${ibmPlexMono.variable} ${bricolage.variable} ${splineSans.variable} ${splineMono.variable} antialiased bg-[#12151a] text-[#ececec]`}
        suppressHydrationWarning
      >
        {/* Site-wide WebSite graph + SearchAction, so search engines can offer
            a sitelinks search box pointed at intervu's own jobs search. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd) }}
        />
        {/* Instrument product is dark-void only. Force `.dark` before paint and
            migrate any leftover light preference (`intervu-dark=0`) so the
            TopBar can never render as a light strip over dark pages. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.classList.add('dark');if(localStorage.getItem('intervu-dark')==='0'){localStorage.setItem('intervu-dark','1')}}catch(e){document.documentElement.classList.add('dark')}`,
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
