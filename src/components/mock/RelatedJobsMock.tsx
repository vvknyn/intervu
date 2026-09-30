"use client";

import { useSearchParams } from "next/navigation";
import { JobDetail, RelatedJobsSection } from "@/components/jobs/JobDetail";
import { JobDetailDocument } from "@/components/jobs/JobDetailDocument";
import type { RelatedBasis } from "@/lib/jobs/related-jobs";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import { MOCK_FOR_YOU_DECK_RESUME } from "@/lib/jobs/for-you/mock-deck-fixtures";

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

const LONG = "Product Manager, Payments Infrastructure, Merchant Risk and Cross-Border Settlement Platform (North America)";

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

const LONG_ROWS: PublicJob[] = [
    job({ id: "mock-related-7", title: LONG, company: "Northwind Traders International Holdings Incorporated", company_domain: "northwind-traders.example", location: "San Francisco Bay Area, California, United States", work_type: "hybrid", salary_min: 180_000, salary_max: 240_000, salary_currency: "USD" }),
    ...SIMILAR.slice(0, 2),
];

const MATCH: MatchScore = {
    total: 72,
    components: [{ key: "relevance", label: "Role fit", detail: "Solid overlap with your experience", score: 0.72 }],
};

/** One fixture per pane state worth looking at before a release. */
const STATES: Record<string, { viewed: PublicJob; related: PublicJob[]; basis: RelatedBasis; signedIn?: boolean; variants?: PublicJob[] }> = {
    default: { viewed: job({ id: "mock-viewed", title: "Product Manager", company: "Northwind" }), related: SIMILAR, basis: "title" },
    company: { viewed: job({ id: "mock-viewed", title: "Product Manager", company: "Northwind" }), related: COMPANY, basis: "company" },
    long: {
        viewed: job({
            id: "mock-viewed-long",
            title: LONG,
            company: "Northwind Traders International Holdings Incorporated",
            company_domain: "northwind-traders.example",
            location: "San Francisco Bay Area, California, United States",
            location_city: "San Francisco",
            location_state: "CA",
            location_country: "US",
            work_type: "hybrid",
            salary_min: 180_000,
            salary_max: 240_000,
            salary_currency: "USD",
            tags: ["payments", "risk", "fintech", "cross-border", "settlement", "compliance", "api", "platform", "b2b", "merchant", "fraud", "kyc", "aml", "treasury", "ledger", "sql"],
        }),
        related: LONG_ROWS,
        basis: "title",
        variants: [
            job({ id: "mock-variant-1", title: LONG, company: "Northwind Traders International Holdings Incorporated", location: "New York, NY" }),
            job({ id: "mock-variant-2", title: LONG, company: "Northwind Traders International Holdings Incorporated", location: "Austin, TX" }),
        ],
    },
    nodomain: {
        viewed: job({ id: "mock-viewed-nodomain", title: "Registered Nurse, Night Shift", company: "St. Mary's Community Hospital", company_domain: null, company_open_count: 12 }),
        related: COMPANY.map((j) => ({ ...j, company: "St. Mary's Community Hospital", company_domain: null })),
        basis: "company",
    },
    closed: { viewed: job({ id: "mock-viewed-closed", title: "Product Manager", company: "Northwind", vacancy_status: "closed", ghost_badge: "likely_ghost" }), related: SIMILAR, basis: "title" },
    remote: {
        viewed: job({ id: "mock-viewed-remote", title: "Customer Support Specialist", company: "Globex", company_domain: "globex.example", location: "Remote", location_city: null, location_state: null, location_country: ["US", "Canada"], work_type: "remote", salary_min: 22, salary_max: 28, salary_currency: "USD", salary_period: "hour" }),
        related: SIMILAR,
        basis: "title",
    },
    minimal: {
        viewed: job({
            id: "mock-viewed-minimal",
            title: "Warehouse Associate",
            company: "Initech",
            company_domain: null,
            location: null,
            location_city: null,
            location_state: null,
            location_country: null,
            work_type: "unknown",
            description: null,
            employment_type: "unknown",
            experience_level: "unknown",
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            tags: [],
            company_open_count: null,
            company_opened_90d: null,
            company_closed_90d: null,
        }),
        related: SIMILAR.slice(0, 1),
        basis: "title",
    },
    signedin: { viewed: job({ id: "mock-viewed", title: "Product Manager", company: "Northwind" }), related: SIMILAR, basis: "title", signedIn: true },
};

export function RelatedJobsMock() {
    const params = useSearchParams();
    // `?basis=company` predates `?state=`; it stays an alias for the company state.
    const stateKey = params.get("state") ?? (params.get("basis") === "company" ? "company" : "default");
    const state = STATES[stateKey] ?? STATES.default!;
    const page = params.get("view") === "page";
    const noop = () => {};
    const related = (
        <RelatedJobsSection jobs={state.related} basis={state.basis} companyBrand={state.viewed.company} now={NOW_MS} linkToPages={page} headingLevel={page ? "h2" : "h3"} />
    );
    return (
        <div className="shell-row py-6" data-testid="related-jobs-mock-root" data-state={stateKey}>
            {page ? (
                <>
                    <JobDetailDocument
                        job={state.viewed}
                        now={NOW_MS}
                        source="direct"
                        signedIn={state.signedIn ?? false}
                        pursuit={undefined}
                        onOpenPosting={noop}
                        onGoAfter={noop}
                        matchScore={state.signedIn ? MATCH : null}
                        resume={state.signedIn ? MOCK_FOR_YOU_DECK_RESUME : null}
                        onUploadResume={noop}
                        onSignInToSync={noop}
                    />
                    {/* The page fetches its own list; this shows the shared block with fixtures. */}
                    {related}
                </>
            ) : (
                // Pane width: 63% of the board at xl (JobsContent's split).
                <div className="mx-auto border border-border" style={{ maxWidth: 760 }}>
                    <JobDetail
                        job={state.viewed}
                        now={NOW_MS}
                        source="serp"
                        signedIn={state.signedIn ?? false}
                        pursuit={undefined}
                        onOpenPosting={noop}
                        onGoAfter={noop}
                        variants={state.variants ?? []}
                        collapseDescription={false}
                        matchScore={state.signedIn ? MATCH : null}
                        resume={state.signedIn ? MOCK_FOR_YOU_DECK_RESUME : null}
                        onUploadResume={noop}
                        onSignInToSync={noop}
                    />
                    {/* Same inset as the pane body (JobDetail's scroller is px-4). */}
                    <div className="px-4">{related}</div>
                </div>
            )}
        </div>
    );
}
