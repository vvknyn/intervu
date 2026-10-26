"use client";

import { JobCard } from "@/components/jobs/JobCard";
import type { PublicJob } from "@/lib/jobs/types";

/** Fixture clock, so the rows read the same on every load. */
const NOW = Date.parse("2026-10-26T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const base: Omit<PublicJob, "id" | "title" | "company" | "source" | "posted_at" | "first_seen_at"> = {
    company_domain: null,
    location: "Austin, TX",
    location_city: "Austin",
    location_state: "TX",
    location_country: "US",
    work_type: "onsite",
    description: null,
    employment_type: "full_time",
    experience_level: "mid",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "",
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "clear",
};

const row = (id: string, title: string, source: string, posted: number, firstSeen: number): PublicJob => ({
    ...base,
    id,
    title,
    company: "Acme",
    source,
    posted_at: daysAgo(posted),
    first_seen_at: daysAgo(firstSeen),
});

/** Design fixture for the /jobs row's "New" mark: one row per case, no data fetch. */
const ROWS = [
    row("new", "Newly listed", "onlinejobs", 6, 1),
    row("old", "Listed long ago", "onlinejobs", 40, 39),
    row("relisted", "Relisted", "onlinejobs", 0, 20),
];

export default function JobRowSourceMock() {
    return (
        <main className="mx-auto max-w-3xl">
            {ROWS.map((job) => (
                <JobCard key={job.id} job={job} active={false} opened={false} onClick={() => {}} now={NOW} />
            ))}
        </main>
    );
}
