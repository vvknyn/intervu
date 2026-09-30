"use client";

/**
 * Fixture-driven `/mock/hub-your-jobs` preview. The tracker and Recently
 * viewed band under the pack tiles reads the signed-in account
 * (`usePursuits`, `useViewed`), so its filled, empty, loading and failed
 * states can't be seen signed-out. This renders the real pack tiles
 * (`CategoryHubGrid`) with the real `HubYourJobsView` as its footer, fed
 * static fixtures, so a design pass sees exactly what a signed-in visitor
 * does.
 *
 * `?state=empty | loading | failed | signed-out`; anything else is filled
 * (8 tracked roles, one of them closed, and 24 viewed roles so the 20-row
 * cap shows).
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageLayout } from "@/components/layout/PageLayout";
import { CategoryHubGrid } from "@/components/jobs/CategoryHubGrid";
import { HubYourJobsView } from "@/components/jobs/for-you/HubYourJobs";
import type { JobView } from "@/lib/views/types";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";

const MOCK_NOW = Date.UTC(2026, 8, 29, 15, 0, 0);
const hoursAgo = (h: number) => new Date(MOCK_NOW - h * 3600_000).toISOString();

const ROLES: [title: string, company: string, location: string][] = [
    ["Senior Product Manager, Payments", "Ramp", "New York, NY"],
    ["Product Manager, Growth", "Notion", "San Francisco, CA"],
    ["Staff Product Manager, Platform", "Datadog", "Remote (US)"],
    ["Product Lead, Onboarding", "Wealthsimple", "Toronto, ON"],
    ["Group Product Manager, Identity", "Okta", "Remote (Canada)"],
    ["Senior Product Manager, AI Assistants", "Intercom", "Remote (US)"],
    ["Product Manager, Marketplace", "Faire", "Remote (US)"],
    ["Customer Success Manager, Enterprise", "Figma", "New York, NY"],
    ["Principal Product Manager, Data", "Snowflake", "Bellevue, WA"],
    ["Product Manager, Checkout", "Shopify", "Remote (Canada)"],
    ["Senior Product Manager, Mobile", "Duolingo", "Pittsburgh, PA"],
    ["Product Operations Lead", "Linear", "Remote (Global)"],
    ["Senior Product Manager, Search", "Algolia", "Remote (US)"],
    ["Product Manager, Billing", "Stripe", "Seattle, WA"],
    ["Technical Product Manager, APIs", "Twilio", "Remote (US)"],
    ["Product Manager, Trust & Safety", "Discord", "San Francisco, CA"],
    ["Senior Product Manager, Analytics", "Amplitude", "Remote (US)"],
    ["Product Manager, Integrations", "Zapier", "Remote (Global)"],
    ["Lead Product Manager, Lending", "Affirm", "Remote (US)"],
    ["Product Manager, Developer Experience", "Vercel", "Remote (US)"],
    ["Senior Product Manager, Workflows", "Asana", "San Francisco, CA"],
    ["Product Manager, Security", "1Password", "Remote (Canada)"],
    ["Product Manager, Hardware", "Oura", "San Francisco, CA"],
    ["Senior Product Manager, Ads", "Reddit", "Remote (US)"],
];

const jobId = (i: number) => `mock-job-${i + 1}`;

const FIXTURE_VIEWS: JobView[] = ROLES.map(([title, company, location], i) => ({
    id: `v${i + 1}`,
    user_id: "mock-user",
    job_id: jobId(i),
    first_viewed_at: hoursAgo(3 * i + 40),
    last_viewed_at: hoursAgo(i === 0 ? 0.5 : 3 * i + 1),
    view_count: 1 + (i % 3),
    job_snapshot: { title, company, location, apply_url: `https://example.com/apply/${i + 1}` },
}));

function fixturePursuit(i: number, status: PursuitStage, createdH: number, updatedH: number, appliedH?: number): Pursuit {
    const [title, company, location] = ROLES[i]!;
    return {
        id: `p-${i + 1}`,
        company_name: company,
        position: title,
        status,
        user_id: "mock-user",
        created_at: hoursAgo(createdH),
        updated_at: hoursAgo(updatedH),
        applied_at: appliedH === undefined ? undefined : hoursAgo(appliedH),
        job_id: jobId(i),
        job_snapshot: { title, company, location, apply_url: `https://example.com/apply/${i + 1}` },
    };
}

const FIXTURE_PURSUITS: Pursuit[] = [
    fixturePursuit(1, "interviewing", 400, 20, 300),
    fixturePursuit(0, "applied", 30, 2, 2),
    fixturePursuit(4, "applied", 500, 480, 480),
    fixturePursuit(8, "offer", 900, 50, 800),
    fixturePursuit(3, "interested", 10, 10),
    fixturePursuit(6, "resume_ready", 60, 30),
    fixturePursuit(9, "interested", 120, 120),
    fixturePursuit(12, "rejected", 700, 200, 650),
];

function HubYourJobsMockBody() {
    const state = useSearchParams().get("state");
    const empty = state === "empty";
    const loading = state === "loading";
    const failed = state === "failed";
    return (
        <PageLayout fullWidth>
            <div className="shell-row pb-16 pt-6">
                <CategoryHubGrid
                    isAuthenticated={state !== "signed-out"}
                    userName="Vivek"
                    hasResume
                    onSelectCategory={() => {}}
                    footer={
                        <HubYourJobsView
                            signedIn={state !== "signed-out"}
                            returnTo="/jobs?view=for-you"
                            nowMs={MOCK_NOW}
                            pursuits={empty || loading || failed ? [] : FIXTURE_PURSUITS}
                            trackerLoading={loading}
                            trackerFailed={failed}
                            onRetryTracker={() => {}}
                            views={empty || loading || failed ? [] : FIXTURE_VIEWS}
                            recentLoading={loading}
                            recentFailed={failed}
                            onRetryRecent={() => {}}
                        />
                    }
                />
            </div>
        </PageLayout>
    );
}

export function HubYourJobsMockClient() {
    return (
        <Suspense fallback={null}>
            <HubYourJobsMockBody />
        </Suspense>
    );
}
