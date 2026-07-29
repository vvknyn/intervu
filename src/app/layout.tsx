import type { Metadata } from "next";
import { Archivo, Bricolage_Grotesque, IBM_Plex_Mono, Spline_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import "./elite-signal.css";
import { TopBar } from "@/components/layout/TopBar";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TourProvider } from "@/components/tour/TourProvider";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { TourTrigger } from "@/components/tour/TourTrigger";
import { Toaster } from "@/lib/toast";

// Editorial pass typeface pair (see globals.css --font-sans/--font-mono/
// --font-display). One Archivo instance covers both display (800/900,
// wordmark + one heading per page) and UI/body (400-600) — same family, so
// there's one font load, not two. IBM Plex Mono carries every number,
// timestamp, verdict, and micro-label — the page's data texture.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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

const SITE_URL = "https://intervu.cc";
const SITE_TITLE = "Intervu";
// Reused verbatim from the jobs page's own <PageHeader> copy (src/app/page.tsx)
// now that jobs is the root experience — no new marketing copy per PR 1.
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
    "interview prep",
    "resume builder",
    "job application tracker",
    "cover letter",
    "job search",
  ],
  alternates: {
    canonical: "/",
  },
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${archivo.variable} ${ibmPlexMono.variable} ${bricolage.variable} ${splineSans.variable} ${splineMono.variable} antialiased`}
        suppressHydrationWarning
      >
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
            <TourOverlay />
            <TourTrigger />
            <Toaster />
          </TourProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
