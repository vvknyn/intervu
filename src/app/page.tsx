import type { Metadata } from "next";
import { Suspense } from "react";
import { getMarketingStatsAction } from "@/actions/marketing";
import { InstrumentDeck } from "@/components/marketing/InstrumentDeck";
import { OPENCLAW_SUBLINE } from "@/components/marketing/openclaw-content";
import { formatCorpusCount } from "@/lib/jobs/corpus-count";
import { SITE_URL } from "@/lib/seo/constants";

export const metadata: Metadata = {
    title: "Intervu — an overnight job-search agent",
    description: OPENCLAW_SUBLINE,
    alternates: {
        canonical: "/",
    },
    openGraph: {
        title: "Intervu — an overnight job-search agent",
        description: OPENCLAW_SUBLINE,
        url: SITE_URL,
    },
    twitter: {
        title: "Intervu — an overnight job-search agent",
        description: OPENCLAW_SUBLINE,
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
