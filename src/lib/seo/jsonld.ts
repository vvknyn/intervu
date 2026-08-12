/**
 * Typed JSON-LD builders for the pages that need structured data.
 *
 * Each builder is a pure function: given the data a page already fetched
 * (never a fresh query of its own), it returns a plain schema.org object or
 * `null` when the page doesn't have enough to say anything truthful — never
 * a fabricated placeholder. Callers render the result with `serializeJsonLd`
 * inside a `<script type="application/ld+json">` tag.
 */
import type { PublicJob } from "@/lib/jobs/types";
import { toValueArray } from "@/lib/jobs/types";
import { getSiteUrl, SITE_NAME } from "./constants";

export interface FaqItem {
  question: string;
  answer: string;
}

interface FaqPageJsonLd {
  "@context": "https://schema.org";
  "@type": "FAQPage";
  mainEntity: {
    "@type": "Question";
    name: string;
    acceptedAnswer: { "@type": "Answer"; text: string };
  }[];
}

interface ArticleJsonLd {
  "@context": "https://schema.org";
  "@type": "Article";
  headline: string;
  datePublished: string;
  dateModified: string;
  description?: string;
  url: string;
  publisher: { "@type": "Organization"; name: string; url: string };
  mainEntityOfPage: { "@type": "WebPage"; "@id": string };
}

interface WebsiteJsonLd {
  "@context": "https://schema.org";
  "@type": "WebSite";
  url: string;
  name: string;
  potentialAction: {
    "@type": "SearchAction";
    target: string;
    "query-input": "required name=search_term_string";
  };
}

interface OrganizationJsonLd {
  "@context": "https://schema.org";
  "@type": "Organization";
  name: string;
  url: string;
  logo: string;
}

/**
 * Serialize a JSON-LD payload for a `dangerouslySetInnerHTML` script tag.
 * Escapes `<` so a value containing `</script>` (or an HTML comment opener)
 * can't break out of the script tag or get sniffed as markup.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Builds a FAQPage graph from caller-supplied Q/A pairs, dropping any pair
 *  missing a question or answer. Returns `null` when nothing valid remains
 *  so callers can skip rendering the script tag entirely rather than emit
 *  an empty `mainEntity`. */
export function buildFaqPageJsonLd(items: FaqItem[]): FaqPageJsonLd | null {
  const valid = items.filter((item) => item.question.trim() && item.answer.trim());
  if (valid.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: valid.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export interface CompanyFaqInput {
  companyName: string;
  /** The page's OWN visible answer to "Is X hiring?" — `buildCompanyHiringAnswer`
   *  (lib/companies/presentation.ts) `.headline`, the exact sentence rendered
   *  in the body. Passed in rather than re-derived from the count here: a
   *  FAQPage answer is a machine-readable assertion that must match what the
   *  page shows a human, and two independent wordings of the same count is
   *  precisely how that match rots. It also keeps the honesty rules about
   *  floors ("200+") and zero-role employers stated once. */
  hiringAnswer: string;
  /** Share of tracked postings flagged with a possible-ghost-job signal, or
   *  `null` when the company has no scored postings to derive a share from
   *  — that question is skipped rather than answered with a fabricated 0%. */
  ghostFlaggedPct: number | null;
}

/**
 * Company-page FAQ content ("Is X hiring?" / "Does X have ghost-job risk?"),
 * built only from fields the page itself renders (KPI tiles on `/co/[slug]`)
 * — never a claim the page doesn't also show a human reader.
 */
export function buildCompanyFaqItems(input: CompanyFaqInput): FaqItem[] {
  const items: FaqItem[] = [
    {
      question: `Is ${input.companyName} hiring?`,
      answer: input.hiringAnswer,
    },
  ];
  if (input.ghostFlaggedPct != null) {
    items.push({
      question: `Does ${input.companyName} have ghost-job risk?`,
      answer: `${input.ghostFlaggedPct}% of ${input.companyName}'s tracked postings carry a possible-ghost-job signal from our automated checks — not a verdict, worth verifying before you invest time.`,
    });
  }
  return items;
}

export interface ArticleJsonLdInput {
  headline: string;
  /** ISO 8601 date/datetime string. */
  datePublished: string;
  /** Defaults to `datePublished` when the article hasn't been revised since. */
  dateModified?: string;
  description?: string | null;
  /** Path relative to the site origin, e.g. "/research/ghost-jobs". */
  path: string;
}

export function buildArticleJsonLd(input: ArticleJsonLdInput): ArticleJsonLd {
  const siteUrl = getSiteUrl();
  const url = `${siteUrl}${input.path}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    ...(input.description ? { description: input.description } : {}),
    url,
    publisher: { "@type": "Organization", name: SITE_NAME, url: siteUrl },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}

/** Site-wide WebSite graph with a SearchAction pointed at the jobs search
 *  root (`/?q=`) — the query intervu's own search box already runs. */
export function buildWebsiteJsonLd(): WebsiteJsonLd {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    url: siteUrl,
    name: SITE_NAME,
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

/** Site-wide Organization graph — name, url, and a real (not favicon-sized)
 *  logo, generated by scripts/generate-favicons.mjs from the same brand
 *  mark every other icon derives from. */
export function buildOrganizationJsonLd(): OrganizationJsonLd {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: siteUrl,
    logo: `${siteUrl}/icon-512.png`,
  };
}

interface JobPostingLocation {
  "@type": "Place";
  address: { "@type": "PostalAddress"; addressCountry?: string; addressLocality?: string };
}

export interface JobPostingJsonLd {
  "@context": "https://schema.org";
  "@type": "JobPosting";
  title: string;
  url: string;
  directApply: false;
  hiringOrganization: { "@type": "Organization"; name: string };
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  jobLocation?: JobPostingLocation[];
}

/** Mirrors `EMPLOYMENT_TYPES` (`@/lib/agent/facets`) — the codebase's one enum of
 *  real `employment_type` values — onto schema.org's `employmentType` vocabulary. */
const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  full_time: "FULL_TIME",
  contract: "CONTRACTOR",
  part_time: "PART_TIME",
  internship: "INTERN",
};

/** `location_country` funnels through the shared `toValueArray` seam (see its
 *  docstring in `@/lib/jobs/types`) so this doesn't re-derive its own
 *  scalar-vs-array normalization. */
function toPlaces(job: PublicJob): JobPostingLocation[] | undefined {
  const countries = toValueArray(job.location_country);
  if (countries.length === 0) return undefined;
  return countries.map((country) => ({
    "@type": "Place" as const,
    address: {
      "@type": "PostalAddress" as const,
      addressCountry: country,
      ...(job.location_city ? { addressLocality: job.location_city } : {}),
    },
  }));
}

/** Every field is omitted when absent — never null, never a placeholder. `directApply`
 *  is false because applying always leaves for the employer's own ATS. */
export function buildJobPostingJsonLd(job: PublicJob, path: string): JobPostingJsonLd {
  const places = toPlaces(job);
  const employmentType = EMPLOYMENT_TYPE_MAP[job.employment_type];
  const closed = job.vacancy_status === "closed";
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    url: `${getSiteUrl()}${path}`,
    directApply: false,
    hiringOrganization: { "@type": "Organization", name: job.company ?? "Unlisted employer" },
    ...(job.description ? { description: job.description } : {}),
    ...(job.posted_at ? { datePosted: job.posted_at } : {}),
    ...(closed && job.updated_at ? { validThrough: job.updated_at } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(places ? { jobLocation: places } : {}),
  };
}
