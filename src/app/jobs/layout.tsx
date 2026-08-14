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
    openGraph: {
        type: "website",
        locale: "en_US",
        siteName: SITE_NAME,
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
        url: `${getSiteUrl()}/jobs`,
        images: [
            {
                url: `${getSiteUrl()}/icon-512.png`,
                width: 512,
                height: 512,
                alt: "Intervu - Live Job Search and Verified Postings",
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
        images: [`${getSiteUrl()}/icon-512.png`],
    },
};


export default function JobsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
