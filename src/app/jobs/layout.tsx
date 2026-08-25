import type { Metadata } from "next";
import {
    getSiteUrl,
    LANDING_DESCRIPTION,
    LANDING_TITLE,
    SITE_KEYWORDS,
    SITE_NAME,
} from "@/lib/seo/constants";

/**
 * /jobs is the front door (spec Phase 1b — `/` redirects here), and its page
 * is a client component, so the front-door metadata lives in this layout.
 */
export const metadata: Metadata = {
    title: { absolute: LANDING_TITLE },
    description: LANDING_DESCRIPTION,
    keywords: SITE_KEYWORDS,
    alternates: {
        canonical: "/jobs",
    },
    // No `images` here either (same fix as root layout.tsx, 2026-08-24):
    // /jobs is the front door `/` redirects to, so THIS explicit array —
    // not the root layout's — was the one actually serving the 512x512
    // square app icon as prod's og:image. Leaving it unset lets it fall
    // back to the root's file-based opengraph-image.tsx (1200x630) since
    // /jobs has no more specific generator of its own; /jobs/[slug] keeps
    // its own per-job opengraph-image.tsx, which is more specific than
    // either and still wins.
    openGraph: {
        type: "website",
        locale: "en_US",
        siteName: SITE_NAME,
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
        url: `${getSiteUrl()}/jobs`,
    },
    twitter: {
        card: "summary_large_image",
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
    },
};


export default function JobsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
