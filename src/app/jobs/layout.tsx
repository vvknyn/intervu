import type { Metadata } from "next";
import { headers } from "next/headers";
import {
    getSiteUrl,
    LANDING_DESCRIPTION,
    LANDING_TITLE,
    SITE_KEYWORDS,
    SITE_NAME,
} from "@/lib/seo/constants";
import { JOBS_QUERY_HEADER } from "@/lib/seo/jobs-query-header";

function jobsBaseMetadata(): Metadata {
    return {
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
        },
        twitter: {
            card: "summary_large_image",
            title: LANDING_TITLE,
            description: LANDING_DESCRIPTION,
        },
    };
}

/**
 * /jobs is the front door (spec Phase 1b — `/` redirects here), and its page
 * is a client component, so the front-door metadata lives in this layout.
 * Parameterized `/jobs?...` URLs stay canonical to `/jobs` but emit noindex
 * HTML meta to match middleware's `X-Robots-Tag`.
 */
export async function generateMetadata(): Promise<Metadata> {
    const headerList = await headers();
    const hasQuery = headerList.get(JOBS_QUERY_HEADER) === "1";
    const base = jobsBaseMetadata();
    if (!hasQuery) return base;
    return {
        ...base,
        robots: { index: false, follow: false, noarchive: true, nosnippet: true },
    };
}

export default function JobsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
