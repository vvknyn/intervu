import type { Metadata } from "next";
import { Bricolage_Grotesque, Spline_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import { TopBar } from "@/components/layout/TopBar";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TourProvider } from "@/components/tour/TourProvider";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { TourTrigger } from "@/components/tour/TourTrigger";
import { Toaster } from "@/lib/toast";

// Portal redesign typeface trio (see globals.css --font-sans/--font-mono/
// --font-display). Bricolage Grotesque carries headlines/wordmark/numerals,
// Spline Sans is body/UI, Spline Sans Mono is meta lines/labels/timestamps.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const splineSans = Spline_Sans({
  variable: "--font-spline-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const splineSansMono = Spline_Sans_Mono({
  variable: "--font-spline-sans-mono",
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
        className={`${bricolage.variable} ${splineSans.variable} ${splineSansMono.variable} antialiased`}
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
