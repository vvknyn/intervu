"use client";

import { useSearchParams } from "next/navigation";
import { JobDetail, RelatedJobsSection } from "@/components/jobs/JobDetail";
import type { PublicJob } from "@/lib/jobs/types";

const NOW_MS = Date.UTC(2026, 8, 30, 12, 0, 0);
const daysAgo = (d: number) => new Date(NOW_MS - d * 86_400_000).toISOString();

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id" | "title" | "company">): PublicJob {
    return {
        company_domain: "northwind.example",
        location: "Toronto, ON",
        location_city: "Toronto",
        location_state: "ON",
        location_country: "Canada",
        work_type: "onsite",
        description:
            "About the role\n\nOwn the roadmap for our creator storefronts.\n\nResponsibilities\n\nRun discovery with creators and ship with design and engineering.\n\nRequirements\n\nFour years of product management in e-commerce.",
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: 85_000,
        salary_max: 100_000,
        salary_currency: "CAD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["product", "e-commerce"],
        apply_url: "https://example.com/apply/mock",
        source: "mock-related-fixture",
        posted_at: daysAgo(8),
        first_seen_at: daysAgo(8),
        posted_ts: NOW_MS - 8 * 86_400_000,
        updated_at: daysAgo(1),
        vacancy_status: "open",
        ghost_badge: "clear",
        company_open_count: 4,
        company_opened_90d: 6,
        company_closed_90d: 2,
        ...overrides,
    };
}

const VIEWED = job({ id: "mock-related-viewed", title: "Product Manager", company: "Northwind" });

const SIMILAR: PublicJob[] = [
    job({ id: "mock-related-1", title: "Product Manager, Growth", company: "Globex", company_domain: "globex.example", location: "Remote", work_type: "remote" }),
    job({ id: "mock-related-2", title: "Senior Product Manager", company: "Initech", company_domain: "initech.example", location: null, salary_min: 110_000, salary_max: 130_000 }),
    job({ id: "mock-related-3", title: "Product Manager, Payments and Checkout Platform for Marketplace Sellers", company: "Umbrella", company_domain: "umbrella.example", posted_at: daysAgo(9), posted_ts: NOW_MS - 9 * 86_400_000 }),
];

const COMPANY: PublicJob[] = [
    job({ id: "mock-related-4", title: "Product Designer", company: "Northwind", location: "Remote", work_type: "remote" }),
    job({ id: "mock-related-5", title: "Go-To-Market (GTM) Lead", company: "Northwind", location: null, salary_min: 90_000 }),
    job({ id: "mock-related-6", title: "Senior Product Developer", company: "Northwind", location: null, salary_max: 95_000 }),
];

export function RelatedJobsMock() {
    const basis = useSearchParams().get("basis") === "company" ? "company" : "title";
    return (
        <div className="shell-row py-6" data-testid="related-jobs-mock-root">
            <div className="mx-auto max-w-3xl border border-border">
                <JobDetail
                    job={VIEWED}
                    now={NOW_MS}
                    source="serp"
                    signedIn={false}
                    pursuit={undefined}
                    onOpenPosting={() => {}}
                    onGoAfter={() => {}}
                    collapseDescription={false}
                />
                {/* Same inset as the pane body (JobDetail's scroller is px-4). */}
                <div className="px-4">
                    <RelatedJobsSection
                        jobs={basis === "company" ? COMPANY : SIMILAR}
                        basis={basis}
                        companyBrand="Northwind"
                        now={NOW_MS}
                    />
                </div>
            </div>
        </div>
    );
}
