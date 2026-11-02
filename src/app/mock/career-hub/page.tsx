import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CareerHubBody } from "@/components/seo/CareerHubBody";
import type { DirectoryCompany } from "@/lib/companies/directory-model";
import type { PublicJob } from "@/lib/jobs/types";
import { getAllCareerHubSlugs, getCareerHub } from "@/lib/seo/career-hubs";
import type { HubFacts } from "@/lib/seo/hub-facts";

export const metadata: Metadata = {
  title: "Career hub mock",
};

/**
 * Fixture harness for /careers/[slug]: the real `CareerHubBody` over made-up facts. The live page draws its count, its
 * companies and its newest roles only when the search index answers, which a cloud session cannot reach, so without
 * this the audit sees the hub with those three sections missing (journey J-MOB-33). `?hub=<slug>` picks the hub (the
 * first by default). 404 in production (mock/layout.tsx).
 */
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const DAY = 86_400_000;

const COMPANIES = ["Acme Robotics", "Northwind Traders", "Globex Logistics", "Initech Systems", "Umbrella Health", "Soylent Foods", "Hooli Cloud", "Stark Industrial Design", "Wayne Enterprises Canada", "Tyrell Biotech"];
const PLACES: [string, string, string][] = [
  ["Columbus, OH, United States", "Columbus", "United States"],
  ["Toronto, ON, Canada", "Toronto", "Canada"],
  ["London, United Kingdom", "London", "United Kingdom"],
  ["Remote", "", ""],
];

function job(i: number): PublicJob {
  const [location, city, country] = PLACES[i % PLACES.length];
  const company = COMPANIES[i % COMPANIES.length];
  return {
    id: `mock-hub-${i}`,
    title: i % 3 === 0 ? "Senior Staff Software Engineer, Platform Reliability and Developer Productivity" : "Product Manager",
    company,
    company_domain: `${company.toLowerCase().replace(/[^a-z]+/g, "-")}.example`,
    location,
    location_city: city || null,
    location_state: null,
    location_country: country || null,
    work_type: country ? "onsite" : "remote",
    description: null,
    employment_type: "full_time",
    experience_level: "mid",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://example.com/apply",
    source: "mock",
    posted_at: new Date(NOW - (i + 1) * DAY).toISOString(),
    posted_ts: NOW - (i + 1) * DAY,
    first_seen_at: null,
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "clear",
  };
}

const facts: HubFacts = {
  total: 18_432,
  roles: Array.from({ length: 8 }, (_, i) => job(i)),
  companies: COMPANIES.map((name, i): DirectoryCompany => ({
    name,
    letter: name[0],
    domain: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}.example`,
    openRoleCount: 40 - i,
    computedAt: null,
  })),
};

export default async function MockCareerHubPage({ searchParams }: { searchParams: Promise<{ hub?: string }> }) {
  const { hub: slug } = await searchParams;
  const hub = getCareerHub(slug ?? getAllCareerHubSlugs()[0]);
  if (!hub) notFound();
  return <CareerHubBody hub={hub} facts={facts} now={NOW + DAY / 2} />;
}
