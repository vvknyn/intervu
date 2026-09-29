"use client";

/**
 * Fixture-driven `/mock/today` preview. The Today header reads a live
 * search, the tracker and this device's last visit, so its states can't be
 * seen on demand. This renders the real `TodayHomeView` over the real pack
 * tiles (`CategoryHubGrid` with `compactHeader`), fed static fixtures.
 *
 * `?state=first | empty | loading | failed | guest`; anything else is filled
 * (last here Friday, 7 new matches, 2 of 12 applied, 3 follow-ups, 1
 * interview). `guest` is a signed-out visitor: the fit preview and the gate.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SignupGate } from "@/components/auth/SignupGate";
import { PageLayout } from "@/components/layout/PageLayout";
import { CategoryHubGrid } from "@/components/jobs/CategoryHubGrid";
import { TodayHomeView } from "@/components/jobs/for-you/TodayHome";
import { FIT_GUEST_PREVIEW_ROWS } from "@/lib/jobs/fit-gate";
import type { TodayRole } from "@/lib/jobs/for-you/today";
import type { PublicJob } from "@/lib/jobs/types";

const MOCK_NOW = Date.UTC(2026, 8, 29, 15, 0, 0);
const hoursAgo = (h: number) => new Date(MOCK_NOW - h * 3600_000).toISOString();

const ROLES: [title: string, company: string, domain: string, city: string | null, workType: PublicJob["work_type"], salary: [number, number] | null, total: number, postedH: number][] = [
    ["Senior Product Manager, Payments", "Wealthsimple", "wealthsimple.com", "Toronto", "hybrid", [150_000, 175_000], 91, 2],
    ["Product Manager, Merchant Onboarding", "Shopify", "shopify.com", null, "remote", null, 88, 5],
    ["Group Product Manager, Risk", "Cohere", "cohere.com", "Toronto", "hybrid", null, 84, 26],
    ["Product Lead, Growth", "KOHO", "koho.ca", null, "remote", [140_000, 160_000], 72, 30],
    ["Senior Product Manager, Search", "Faire", "faire.com", "Toronto", "onsite", null, 66, 50],
    ["Product Manager, Billing", "Wave", "waveapps.com", "Toronto", "hybrid", [120_000, 135_000], 63, 70],
    ["Product Manager, Identity", "1Password", "1password.com", null, "remote", null, 61, 80],
];

const FIXTURE_ROLES: TodayRole[] = ROLES.map(([title, company, domain, city, workType, salary, total, postedH], i) => ({
    job: {
        id: `mock-today-${i + 1}`,
        title,
        company,
        company_domain: domain,
        location: null,
        location_city: city,
        location_state: city ? "ON" : null,
        location_country: "Canada",
        work_type: workType,
        description: null,
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: salary?.[0] ?? null,
        salary_max: salary?.[1] ?? null,
        salary_currency: salary ? "CAD" : null,
        salary_period: salary ? "year" : null,
        visa_sponsorship: null,
        tags: [],
        apply_url: `https://example.com/apply/${i + 1}`,
        source: "mock",
        posted_at: hoursAgo(postedH),
        first_seen_at: hoursAgo(postedH),
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
        ghost_checked_at: null,
    } as PublicJob,
    score: { total, components: [] },
}));

function TodayMockBody() {
    const state = useSearchParams().get("state");
    const first = state === "first";
    const guest = state === "guest";
    const status = state === "loading" ? "loading" : state === "failed" ? "failed" : "ready";
    const roles = state === "empty" || status !== "ready" ? [] : FIXTURE_ROLES;
    return (
        <PageLayout fullWidth>
            <div className="shell-row pb-16 pt-6">
                <TodayHomeView
                    title={guest ? "Your matches" : "Welcome, Vivek"}
                    lastHere={first ? null : "Friday"}
                    since={first ? "this week" : "since Friday"}
                    status={status}
                    roles={roles}
                    saturated={false}
                    appliedToday={first ? 0 : 2}
                    followUps={first ? 0 : 3}
                    interviews={first ? 0 : 1}
                    nowMs={MOCK_NOW}
                    rowLimit={guest ? FIT_GUEST_PREVIEW_ROWS : undefined}
                    gate={
                        guest ? (
                            <SignupGate
                                reason="fit"
                                originSurface="for_you"
                                returnTo="/jobs?view=for-you"
                                count={{ kind: "exact", value: roles.length }}
                                className="w-full"
                            />
                        ) : null
                    }
                    onApply={() => {}}
                    onSkip={() => {}}
                    onOpenPack={() => {}}
                    onRetry={() => {}}
                />
                <CategoryHubGrid
                    compactHeader
                    isAuthenticated={!guest}
                    userName="Vivek"
                    hasResume
                    hubCorpusLine="~508 matches ranked Strong first"
                    onSelectCategory={() => {}}
                />
            </div>
        </PageLayout>
    );
}

export function TodayMockClient() {
    return (
        <Suspense fallback={null}>
            <TodayMockBody />
        </Suspense>
    );
}
