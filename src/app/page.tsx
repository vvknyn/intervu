import type { Metadata } from "next";
import { Suspense } from "react";
import { getMarketingStatsAction } from "@/actions/marketing";
import { InstrumentDeck } from "@/components/marketing/InstrumentDeck";
import { formatCorpusCount } from "@/lib/jobs/corpus-count";
import { LANDING_DESCRIPTION, LANDING_TITLE, SITE_URL } from "@/lib/seo/constants";

export const metadata: Metadata = {
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    alternates: {
        canonical: "/",
    },
    openGraph: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
        url: SITE_URL,
    },
    twitter: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
    },
};

/** Full-bleed landing instrument — TopBar/Footer/MobileTabBar hidden via shouldHideSiteChrome. */
export default async function HomePage() {
    const stats = await getMarketingStatsAction();
    const jobCount = stats ? formatCorpusCount(stats.liveJobs) : null;
    return (
        <Suspense fallback={null}>
            <InstrumentDeck jobCount={jobCount} />
        </Suspense>
    );
}
