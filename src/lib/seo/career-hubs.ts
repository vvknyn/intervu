import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import type { FacetKey } from "@/lib/jobs/types";
import { PUBLIC_ANTI_SCORE_SENTENCE } from "@/lib/marketing/public-copy";

/**
 * Closed registry of indexable career-intent hubs — not every occupation,
 * only the search phrases worth a dedicated landing page.
 */
export type CareerHubJobsFacetKey = Extract<
  FacetKey,
  "location_country" | "location_city" | "location_state"
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
  jobsFacets?: Partial<Record<CareerHubJobsFacetKey, string>>;
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
    relatedSlugs: ["work-from-home-jobs", "tech-jobs", "canada-jobs", "remote-jobs-canada"],
    alternativePath: "/indeed-alternative",
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
    relatedSlugs: ["healthcare-jobs", "open-positions", "canada-jobs"],
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
    relatedSlugs: ["healthcare-jobs", "entry-level-jobs", "canada-jobs"],
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
  },
  {
    slug: "canada-jobs",
    path: "/careers/canada-jobs",
    title: "Canada jobs from employer career pages | Velai",
    description:
      "Jobs in Canada sourced from company career pages — Toronto, Vancouver, Montreal, Calgary, Ottawa, and remote. Screened for freshness.",
    h1: "Canada jobs from the employer's career page",
    intro: [
      "Most Canadians already search Job Bank, Indeed.ca, or Eluta when they want listings tied to real employers. Velai reads the same source Eluta chases — the company's own career page — and adds freshness screening so a role that closed on the employer site does not keep showing up here.",
      "Browse openings across Ontario, British Columbia, Alberta, and Quebec. When a posting includes pay, we show it in CAD where the employer published it. City hubs below narrow Toronto, Vancouver, Montreal, Calgary, and Ottawa without mixing in US-only aggregator copy.",
    ],
    relatedSlugs: [
      "toronto-jobs",
      "vancouver-jobs",
      "montreal-jobs",
      "calgary-jobs",
      "ottawa-jobs",
      "remote-jobs-canada",
      "remote-jobs",
    ],
    alternativePath: "/eluta-alternative",
    jobsFacets: { location_country: "Canada" },
  },
  {
    slug: "toronto-jobs",
    path: "/careers/toronto-jobs",
    title: "Jobs in Toronto from employer career pages | Velai",
    description:
      "Toronto and GTA jobs read from company career pages — not leftover ads on downtown job boards. Screened for stale listings.",
    h1: "Toronto jobs from the career page, not the board pile",
    intro: [
      "The GTA has no shortage of job boards, but a downtown filter often mixes fresh employer posts with listings that outlived the req. Velai tracks what companies still show on their own hiring sites across Toronto and the wider metro area.",
      "Search finance, tech, healthcare, and operations roles with posting-age signals — so you are not tailoring a cover letter for a job the employer already closed.",
    ],
    relatedSlugs: ["canada-jobs", "vancouver-jobs", "remote-jobs"],
    jobsFacets: { location_city: "Toronto" },
  },
  {
    slug: "vancouver-jobs",
    path: "/careers/vancouver-jobs",
    title: "Jobs in Vancouver from employer career pages | Velai",
    description:
      "Vancouver and Metro Vancouver jobs pulled from company career pages. Verified listings with freshness screening.",
    h1: "Vancouver jobs read from employer hiring sites",
    intro: [
      "Metro Vancouver employers often post on Greenhouse, Lever, or a simple Workday page long before a role becomes a sponsored ad elsewhere. Velai follows those career pages so you see what is open on the coast today.",
      "From tech and film to trades and healthcare, search Vancouver-area roles with the same stale-posting checks we run on every listing — not a reposted copy from a national aggregator.",
    ],
    relatedSlugs: ["canada-jobs", "toronto-jobs", "remote-jobs"],
    jobsFacets: { location_city: "Vancouver" },
  },
  {
    slug: "montreal-jobs",
    path: "/careers/montreal-jobs",
    title: "Jobs in Montreal from employer career pages | Velai",
    description:
      "Montreal jobs from company career pages — English and French listings as the employer published them. Screened for freshness.",
    h1: "Montreal jobs as the employer posted them",
    intro: [
      "Montreal hiring often lives on the company's own site in English, French, or both — not always on a board that flattens the wording. Velai reads the career page listing so you see the title and location the employer actually set.",
      "Search tech, finance, healthcare, and creative roles across the island and surrounding municipalities. Posting-age signals help you skip reqs that stayed visible after the team moved on.",
    ],
    relatedSlugs: ["canada-jobs", "ottawa-jobs", "remote-jobs"],
    jobsFacets: { location_city: "Montreal" },
  },
  {
    slug: "calgary-jobs",
    path: "/careers/calgary-jobs",
    title: "Jobs in Calgary from employer career pages | Velai",
    description:
      "Calgary jobs from company career pages — energy, tech, trades, and professional roles. Screened for stale postings.",
    h1: "Calgary jobs from companies still hiring",
    intro: [
      "Alberta's energy and tech employers publish on their own career pages first. Velai indexes those listings so you are not relying on a board copy that lagged behind the employer's site by weeks.",
      "Search Calgary roles across engineering, operations, skilled trades, and corporate functions with freshness screening on every posting.",
    ],
    relatedSlugs: ["canada-jobs", "vancouver-jobs", "skilled-trades-jobs"],
    jobsFacets: { location_city: "Calgary" },
  },
  {
    slug: "ottawa-jobs",
    path: "/careers/ottawa-jobs",
    title: "Jobs in Ottawa from employer career pages | Velai",
    description:
      "Ottawa jobs from private-sector career pages — alongside public-service listings on Job Bank. Screened for freshness.",
    h1: "Ottawa jobs beyond the public-service board",
    intro: [
      "Job Bank covers a lot of federal and provincial postings, but Ottawa's private tech, healthcare, and professional employers still hire through their own career pages. Velai reads those sites so you do not miss a role that never made it to a national board.",
      "Search Ottawa-area openings with posting-age signals — whether the employer posts in English, French, or both on their hiring site.",
    ],
    relatedSlugs: ["canada-jobs", "montreal-jobs", "toronto-jobs"],
    jobsFacets: { location_city: "Ottawa" },
  },
  {
    slug: "remote-jobs-canada",
    path: "/careers/remote-jobs-canada",
    title: "Remote jobs in Canada from employer career pages | Velai",
    description:
      "Remote jobs for Canada-based candidates, read from company career pages. Screened for stale and ghost postings.",
    h1: "Remote jobs in Canada from the source",
    intro: [
      "Remote-in-Canada filters on big boards often mix US-only reqs, reposted ads, and roles that closed weeks ago. Velai reads what the employer still lists on its career page and scopes to Canada where the posting says so.",
      "Search fully remote and hybrid-friendly roles with posting-age signals — so you spend time on listings the company has not already pulled from its own site.",
    ],
    relatedSlugs: ["canada-jobs", "remote-jobs", "toronto-jobs"],
    jobsFacets: { location_country: "Canada" },
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
  },
] as const;

const hubBySlug = new Map(CAREER_HUBS.map((hub) => [hub.slug, hub]));

export function getCareerHub(slug: string): CareerHub | undefined {
  return hubBySlug.get(slug);
}

export function getAllCareerHubSlugs(): string[] {
  return CAREER_HUBS.map((hub) => hub.slug);
}

/** Build a /jobs deep link from a hub's location facets — null when none set. */
export function careerHubJobsHref(hub: Pick<CareerHub, "jobsFacets">): string | null {
  if (!hub.jobsFacets) return null;
  const facets: Partial<Record<CareerHubJobsFacetKey, string[]>> = {};
  for (const [key, value] of Object.entries(hub.jobsFacets) as [CareerHubJobsFacetKey, string][]) {
    if (value) facets[key] = [value];
  }
  if (Object.keys(facets).length === 0) return null;
  return `/jobs${serializeJobsUrl({ ...DEFAULT_URL_STATE, facets })}`;
}
