import type { Metadata } from "next";
import { Geist_Mono, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { TopBar } from "@/components/layout/TopBar";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TourProvider } from "@/components/tour/TourProvider";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { TourTrigger } from "@/components/tour/TourTrigger";
import { Toaster } from "@/lib/toast";

// Hanken Grotesk is the UI typeface (see globals.css --font-sans); we no longer
// ship Geist Sans. Geist Mono is kept for code/monospace surfaces.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Intervu design-system typeface
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

const SITE_URL = "https://intervu.cc";
const SITE_TITLE = "Intervu";
// Reused verbatim from the jobs page's own <PageHeader> copy (src/app/page.tsx)
// now that jobs is the root experience — no new marketing copy per PR 1.
const SITE_DESCRIPTION = "Search live roles — flagged for ghost-job risk before you spend time on them.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Find jobs",
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
        className={`${geistMono.variable} ${hanken.variable} antialiased`}
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
