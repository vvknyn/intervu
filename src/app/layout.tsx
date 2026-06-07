import type { Metadata } from "next";
import { Geist_Mono, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { AppShellWrapper } from "@/components/layout/AppShellWrapper";
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
const SITE_DESCRIPTION =
  "Your job application workspace — manage resumes, applications, and interview prep in one place. Bring your own API key. No subscriptions.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
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
            <AppShellWrapper>{children}</AppShellWrapper>
            <TourOverlay />
            <TourTrigger />
            <Toaster />
          </TourProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
