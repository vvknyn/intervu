import type { Metadata } from "next";
import { getSiteUrl, LANDING_DESCRIPTION, LANDING_TITLE } from "@/lib/seo/constants";

/**
 * /jobs is the front door (spec Phase 1b — `/` redirects here), and its page
 * is a client component, so the front-door metadata lives in this layout.
 */
export const metadata: Metadata = {
    title: { absolute: LANDING_TITLE },
    description: LANDING_DESCRIPTION,
    alternates: {
        canonical: "/jobs",
    },
    openGraph: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
        url: `${getSiteUrl()}/jobs`,
    },
    twitter: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
    },
};

export default function JobsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
