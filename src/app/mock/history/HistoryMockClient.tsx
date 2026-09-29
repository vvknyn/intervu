"use client";

/**
 * Fixture-driven `/mock/history` preview. `/yours/history`'s filled/empty
 * states have no signed-out path — `useViewed()` has no guest/localStorage
 * fallback the way pursuits does — so this is the only way to pixel-prove
 * those states without signing in. Renders the real `HistoryHeader` /
 * `HistoryList` (and by extension `HistoryRow` / `HistoryEmptyState`)
 * against static fixture data instead of a reimplementation that could
 * drift from what signed-in viewers actually see.
 *
 * `?state=empty` renders the empty state; anything else (default) renders a
 * filled list, including a mix of viewed jobs with and without a matching
 * tracked pursuit — real history rows only show a `StageBadge` when one
 * exists.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageLayout } from "@/components/layout/PageLayout";
import { TrackerTabs } from "@/components/tracker/TrackerTabs";
import { HistoryHeader, HistoryList } from "@/app/yours/history/page";
import type { JobView } from "@/lib/views/types";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";

const MOCK_NOW = Date.UTC(2026, 8, 18, 15, 0, 0);
const hoursAgo = (h: number) => new Date(MOCK_NOW - h * 3600_000).toISOString();

const FIXTURE_VIEWS: JobView[] = [
    {
        id: "v1",
        user_id: "mock-user",
        job_id: "job-1",
        first_viewed_at: hoursAgo(50),
        last_viewed_at: hoursAgo(2),
        view_count: 3,
        job_snapshot: {
            title: "Senior Product Designer",
            company: "Anchorage Digital",
            location: "Remote (US)",
            apply_url: "https://example.com/apply/1",
        },
    },
    {
        id: "v2",
        user_id: "mock-user",
        job_id: "job-2",
        first_viewed_at: hoursAgo(30),
        last_viewed_at: hoursAgo(6),
        view_count: 1,
        job_snapshot: {
            title: "Staff Backend Engineer, Payments",
            company: "Ramp",
            location: "New York, NY",
            apply_url: "https://example.com/apply/2",
        },
    },
    {
        id: "v3",
        user_id: "mock-user",
        job_id: "job-3",
        first_viewed_at: hoursAgo(90),
        last_viewed_at: hoursAgo(20),
        view_count: 5,
        job_snapshot: {
            title: "Growth Marketing Lead",
            company: "Notion",
            location: "San Francisco, CA",
            apply_url: "https://example.com/apply/3",
        },
    },
    {
        id: "v4",
        user_id: "mock-user",
        job_id: "job-4",
        first_viewed_at: hoursAgo(200),
        last_viewed_at: hoursAgo(200),
        view_count: 1,
        job_snapshot: {
            title: "Data Analyst, Marketplace",
            company: "Faire",
            location: "Remote (US)",
            apply_url: "https://example.com/apply/4",
        },
    },
];

function fixturePursuit(job_id: string, status: PursuitStage): Pursuit {
    return {
        id: `p-${job_id}`,
        company_name: "",
        position: "",
        status,
        user_id: "mock-user",
        created_at: hoursAgo(90),
        updated_at: hoursAgo(2),
        job_id,
    };
}

const FIXTURE_BY_JOB_ID = new Map<string, Pursuit>([
    ["job-1", fixturePursuit("job-1", "interviewing")],
    ["job-3", fixturePursuit("job-3", "applied")],
]);

function HistoryMockBody() {
    const searchParams = useSearchParams();
    const empty = searchParams.get("state") === "empty";
    return (
        <PageLayout fullWidth header={<HistoryHeader />}>
            <div className="mx-auto w-full max-w-6xl xl:max-w-7xl px-4 pb-16 pt-6 sm:px-8 xl:px-10">
                <TrackerTabs active="history" />
                <div className="mt-4">
                    <HistoryList loading={false} failed={false} onRetry={() => {}} entries={empty ? [] : FIXTURE_VIEWS} byJobId={FIXTURE_BY_JOB_ID} />
                </div>
            </div>
        </PageLayout>
    );
}

export function HistoryMockClient() {
    return (
        <Suspense fallback={null}>
            <HistoryMockBody />
        </Suspense>
    );
}
