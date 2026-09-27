/**
 * Dev-only fixture data for `/mock/for-you-deck` — three representative
 * `PublicJob` rows and band-only fit labels (Strong / Good / Stretch).
 * No live Meili/WorkOS, no numeric MatchChip / Fit breakdown UI inputs.
 */
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export const MOCK_FOR_YOU_DECK_NOW_MS = Date.UTC(2026, 8, 20, 12, 0, 0);

/** Mock signed-in save latency — long enough for e2e to observe optimistic UI. */
export const MOCK_FOR_YOU_SAVE_DELAY_MS = 600;

const hoursAgo = (h: number) => new Date(MOCK_FOR_YOU_DECK_NOW_MS - h * 3_600_000).toISOString();

function baseJob(overrides: Partial<PublicJob> & Pick<PublicJob, "id" | "title" | "company">): PublicJob {
    return {
        location: "Remote · US",
        location_city: null,
        location_state: null,
        location_country: "US",
        company_domain: null,
        work_type: "remote",
        description:
            "About the role\n\nBuild reliable backend services in TypeScript.\n\nResponsibilities\n\nDesign APIs and ship features with the product team.\n\nRequirements\n\nFive years of experience with Node.js or similar stacks.",
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: 130_000,
        salary_max: 160_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["typescript", "backend"],
        apply_url: "https://example.com/apply/mock",
        source: "mock-deck-fixture",
        posted_at: hoursAgo(48),
        first_seen_at: hoursAgo(48),
        posted_ts: MOCK_FOR_YOU_DECK_NOW_MS - 48 * 3_600_000,
        updated_at: hoursAgo(1),
        vacancy_status: "open",
        ghost_badge: "clear",
        ...overrides,
    };
}

/** Three-pack deck — Strong, Good, Stretch band order (fixture-only ids). */
export const MOCK_FOR_YOU_DECK_JOBS: PublicJob[] = [
    baseJob({
        id: "mock-deck-strong",
        title: "Senior Backend Engineer",
        company: "Acme Platform",
        company_domain: "acme.example",
        location: "Remote · US",
        work_type: "remote",
    }),
    baseJob({
        id: "mock-deck-good",
        title: "Full Stack Engineer",
        company: "Globex Systems",
        company_domain: "globex.example",
        location: "Austin, TX · Hybrid",
        location_city: "Austin",
        location_state: "TX",
        work_type: "hybrid",
        description:
            "About the role\n\nShip customer-facing features across React and API layers.\n\nResponsibilities\n\nOwn vertical slices from design review through deploy.\n\nRequirements\n\nThree or more years with React and REST APIs.",
    }),
    baseJob({
        id: "mock-deck-stretch",
        title: "Analytics Engineer",
        company: "Initech",
        company_domain: "initech.example",
        location: "Denver, CO",
        location_city: "Denver",
        location_state: "CO",
        work_type: "onsite",
        description:
            "About the role\n\nModel product data for internal stakeholders.\n\nResponsibilities\n\nMaintain dbt models and partner with analysts.\n\nRequirements\n\nSQL proficiency and comfort with warehouse tooling.",
        experience_level: "mid",
    }),
];

/** Band totals only — `ForYouPack` renders Strong/Good/Stretch, not numeric receipts. */
export const MOCK_FOR_YOU_DECK_BAND_SCORES: ReadonlyMap<string, MatchScore> = new Map([
    [
        "mock-deck-strong",
        {
            total: 85,
            components: [{ key: "relevance", label: "Role fit", detail: "Aligned with your background", score: 0.85 }],
        },
    ],
    [
        "mock-deck-good",
        {
            total: 68,
            components: [{ key: "relevance", label: "Role fit", detail: "Solid overlap with your experience", score: 0.68 }],
        },
    ],
    [
        "mock-deck-stretch",
        {
            total: 52,
            components: [{ key: "relevance", label: "Role fit", detail: "Partial overlap — worth a closer read", score: 0.52 }],
        },
    ],
]);

export function mockForYouDeckMatchScores(): Map<string, MatchScore | null> {
    return new Map(MOCK_FOR_YOU_DECK_BAND_SCORES);
}

export const MOCK_FOR_YOU_DECK_RESUME: ResumeData = {
    profile: {
        name: "Alex Rivera",
        profession: "Software Engineer",
        yearsOfExperience: 6,
        location: "Remote",
        email: "alex.rivera@example.com",
        phone: "555-010-1000",
    },
    experience: [
        {
            id: "exp-1",
            company: "Acme Corp",
            role: "Senior Software Engineer",
            dates: "2021-Present",
            description: "Backend services in TypeScript and Node.js.",
        },
    ],
    competencies: [{ category: "Languages", skills: ["TypeScript", "JavaScript", "SQL"] }],
    education: [{ id: "edu-1", degree: "B.S. Computer Science", institution: "State University", year: "2018" }],
    generatedSummary: "Software engineer with backend and full-stack experience.",
};
