import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import type { FacetKey } from "@/lib/jobs/types";
import { PUBLIC_ANTI_SCORE_SENTENCE } from "@/lib/marketing/public-copy";

/**
 * Closed registry of indexable career-intent hubs — not every occupation,
 * only the search phrases worth a dedicated landing page.
 */
export type CareerHubJobsFacetKey = Extract<
  FacetKey,
  "location_country" | "location_city" | "location_state" | "work_type" | "experience_level"
>;

export interface CareerHub {
  slug: string;
  path: string;
  title: string;
  description: string;
  h1: string;
  intro: readonly string[];
  relatedSlugs: readonly string[];
  /** Path to one competitor-alternative page when relevant. */
  alternativePath?: string;
  /** The search the hub's main link runs, so a visitor lands on the roles
   *  the page is about rather than on an empty /jobs (focus group,
   *  2026-10-12: every hub linked to bare /jobs). */
  jobsQuery?: string;
  jobsFacets?: Partial<Record<CareerHubJobsFacetKey, string>>;
  /** The main link's words, naming those roles. */
  searchLabel: string;
}

export const CAREER_HUBS: readonly CareerHub[] = [
  {
    slug: "remote-jobs",
    path: "/careers/remote-jobs",
    title: "Remote jobs from company career pages | Velai",
    description:
      "Browse remote jobs pulled straight from employer career pages. Every listing is screened for freshness before you apply.",
    h1: "Remote jobs, read from the career page",
    intro: [
      "Remote listings on big boards often outlive the req. Velai reads what the company still shows on its own hiring site — when they close it there, it leaves here.",
      "Search remote roles across software, healthcare, operations, and more. No reposted copy, no sponsored bump.",
    ],
    relatedSlugs: ["work-from-home-jobs", "tech-jobs"],
    alternativePath: "/indeed-alternative",
    jobsFacets: { work_type: "remote" },
    searchLabel: "Search remote jobs",
  },
  {
    slug: "work-from-home-jobs",
    path: "/careers/work-from-home-jobs",
    title: "Work from home jobs — verified employer listings | Velai",
    description:
      "Work-from-home jobs sourced from company career pages, not aggregator ads. Screened for stale postings and ghost-job risk.",
    h1: "Work from home jobs that match the employer's site",
    intro: [
      "Work-from-home filters on typical job boards mix real remote roles with ads that never leave. Velai tracks the employer's own career page instead.",
      "Use this hub to find WFH-friendly roles with posting-age signals — so you spend time on listings that are still open where it counts.",
    ],
    relatedSlugs: ["remote-jobs", "entry-level-jobs", "open-positions"],
    jobsFacets: { work_type: "remote" },
    searchLabel: "Search work-from-home jobs",
  },
  {
    slug: "software-engineer-jobs",
    path: "/careers/software-engineer-jobs",
    title: "Software engineer jobs from employer career pages | Velai",
    description:
      "Software engineer jobs pulled from company career pages — backend, frontend, full stack, and platform. Screened for freshness.",
    h1: "Software engineer jobs from the source",
    intro: [
      "Engineering reqs recycle fast. Velai shows what is still posted on Greenhouse, Lever, Ashby, and other systems the company actually uses.",
      "Skip the reposted copy and the match-score theater. Search live software roles and see which ones look stale before you tailor a resume.",
    ],
    relatedSlugs: ["tech-jobs", "remote-jobs", "entry-level-jobs"],
    alternativePath: "/linkedin-jobs-alternative",
    jobsQuery: "Software Engineer",
    searchLabel: "Search software engineer jobs",
  },
  {
    slug: "data-scientist-jobs",
    path: "/careers/data-scientist-jobs",
    title: "Data scientist jobs — live employer postings | Velai",
    description:
      "Data scientist and analytics jobs from company career pages. Verified listings with freshness screening.",
    h1: "Data scientist jobs worth a second look",
    intro: [
      "Analytics and data-science reqs are easy to leave open on a board long after the team moved on. Velai reads the employer's career page directly.",
      PUBLIC_ANTI_SCORE_SENTENCE,
    ],
    relatedSlugs: ["tech-jobs", "software-engineer-jobs", "remote-jobs"],
    jobsQuery: "Data Scientist",
    searchLabel: "Search data scientist jobs",
  },
  {
    slug: "nursing-jobs",
    path: "/careers/nursing-jobs",
    title: "Nursing jobs from hospital and health system career pages | Velai",
    description:
      "Nursing and clinical jobs sourced from employer career pages — hospitals, health systems, and care networks.",
    h1: "Nursing jobs from the employer's own site",
    intro: [
      "Clinical hiring moves quickly. Velai tracks nursing and patient-care roles where hospitals publish them — not a stale copy on a generic board.",
      "Search RN, LPN, and specialty nursing openings with the same freshness screening we apply to every listing.",
    ],
    relatedSlugs: ["healthcare-jobs", "open-positions"],
    jobsQuery: "Nurse",
    searchLabel: "Search nursing jobs",
  },
  {
    slug: "healthcare-jobs",
    path: "/careers/healthcare-jobs",
    title: "Healthcare jobs — verified career-page listings | Velai",
    description:
      "Healthcare jobs from employer career pages: clinical, admin, and support roles. Screened for stale and ghost postings.",
    h1: "Healthcare jobs read from career pages",
    intro: [
      "Health systems post on their own sites first. Velai follows those career pages so you see what is still open before you apply.",
      "From nursing to operations, search healthcare roles with posting-age signals instead of aggregator leftovers.",
    ],
    relatedSlugs: ["nursing-jobs", "skilled-trades-jobs", "open-positions"],
    jobsQuery: "Healthcare",
    searchLabel: "Search healthcare jobs",
  },
  {
    slug: "skilled-trades-jobs",
    path: "/careers/skilled-trades-jobs",
    title: "Skilled trades jobs from employer career pages | Velai",
    description:
      "Skilled trades jobs — electrical, plumbing, HVAC, construction, and more — sourced from company career pages.",
    h1: "Skilled trades jobs from companies that are hiring",
    intro: [
      "Trades employers often post on a simple careers page, not a national board. Velai reads those pages so you do not miss local openings.",
      "Search skilled-trades roles with the same freshness checks we run on tech and healthcare listings.",
    ],
    relatedSlugs: ["healthcare-jobs", "entry-level-jobs"],
    jobsQuery: "Electrician",
    searchLabel: "Search electrician jobs",
  },
  {
    slug: "tech-jobs",
    path: "/careers/tech-jobs",
    title: "Tech jobs from company career pages | Velai",
    description:
      "Tech jobs across engineering, product, design, and IT — pulled from employer career pages and screened for ghost-job risk.",
    h1: "Tech jobs without the board noise",
    intro: [
      "Tech hiring runs on career pages long before a role becomes an ad. Velai indexes those pages and flags listings that look stale.",
      "Software, product, design, IT — search live tech roles from the employer's site, not a reposted feed.",
    ],
    relatedSlugs: ["software-engineer-jobs", "remote-jobs", "data-scientist-jobs"],
    alternativePath: "/indeed-alternative",
    jobsQuery: "Software Engineer",
    searchLabel: "Search software jobs",
  },
  {
    slug: "entry-level-jobs",
    path: "/careers/entry-level-jobs",
    title: "Entry level jobs from employer career pages | Velai",
    description:
      "Entry level jobs and early-career roles from company career pages. Fresh listings screened before you apply.",
    h1: "Entry level jobs that are still posted",
    intro: [
      "Early-career reqs are often the first to go stale on a big board. Velai shows what the company still lists on its own career page.",
      "Search internships, associate, and junior roles with posting-age signals — no profile theater required.",
    ],
    relatedSlugs: ["open-positions", "remote-jobs", "tech-jobs"],
    alternativePath: "/linkedin-jobs-alternative",
    jobsFacets: { experience_level: "entry" },
    searchLabel: "Search entry-level jobs",
  },
  {
    slug: "open-positions",
    path: "/careers/open-positions",
    title: "Open positions from company career pages | Velai",
    description:
      "Open positions and job openings read directly from employer career pages — not reposted ads.",
    h1: "Open positions that match the career page",
    intro: [
      "When someone searches open positions, they want to know a role is still live. Velai tracks employer career pages and drops listings when the company closes them.",
      "Browse open roles across industries with freshness screening on every posting.",
    ],
    relatedSlugs: ["company-career-pages", "entry-level-jobs", "remote-jobs"],
    searchLabel: "Search live jobs",
  },
  {
    slug: "company-career-pages",
    path: "/careers/company-career-pages",
    title: "Company career pages — live job openings | Velai",
    description:
      "Search jobs pulled from company career pages. Velai reads employer hiring sites directly and screens for stale listings.",
    h1: "Jobs from company career pages, not aggregator ads",
    intro: [
      "The best signal for whether a company is hiring is still their own career page. Velai reads those pages — Greenhouse, Lever, Ashby, Workday, and others — and shows what is open today.",
      "Use this hub when you want employer career pages in one searchable place, with stale-posting flags on every role.",
    ],
    relatedSlugs: ["open-positions", "remote-jobs", "tech-jobs"],
    alternativePath: "/indeed-alternative",
    searchLabel: "Search live jobs",
  },
] as const;

const hubBySlug = new Map(CAREER_HUBS.map((hub) => [hub.slug, hub]));

export function getCareerHub(slug: string): CareerHub | undefined {
  return hubBySlug.get(slug);
}

export function getAllCareerHubSlugs(): string[] {
  return CAREER_HUBS.map((hub) => hub.slug);
}

/** The /jobs search a hub's main link runs: its query and facets, or plain
 *  /jobs for a hub about every field. */
export function careerHubJobsHref(hub: Pick<CareerHub, "jobsQuery" | "jobsFacets">): string {
  const facets: Partial<Record<CareerHubJobsFacetKey, string[]>> = {};
  for (const [key, value] of Object.entries(hub.jobsFacets ?? {}) as [CareerHubJobsFacetKey, string][]) {
    if (value) facets[key] = [value];
  }
  return `/jobs${serializeJobsUrl({ ...DEFAULT_URL_STATE, q: hub.jobsQuery ?? "", facets })}`;
}
