/**
 * Typed JSON-LD builders for the pages that need structured data.
 *
 * Each builder is a pure function: given the data a page already fetched
 * (never a fresh query of its own), it returns a plain schema.org object or
 * `null` when the page doesn't have enough to say anything truthful — never
 * a fabricated placeholder. Callers render the result with `serializeJsonLd`
 * inside a `<script type="application/ld+json">` tag.
 */
import { companyLogoUrl } from "@/lib/companies/logo";
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
  alternateName?: string[];
  description?: string;
  inLanguage?: string;
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
  description?: string;
  slogan?: string;
  knowsAbout?: string[];
  sameAs?: string[];
}

export interface WebApplicationJsonLd {
  "@context": "https://schema.org";
  "@type": "WebApplication";
  name: string;
  url: string;
  applicationCategory: string;
  operatingSystem: string;
  description?: string;
  offers: {
    "@type": "Offer";
    price: string;
    priceCurrency: string;
  };
  featureList: string[];
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

/**
 * High-intent FAQ schema graph answering searcher questions about how Intervu
 * compares to traditional boards (Indeed, LinkedIn), how ghost job screening works,
 * and listing verification.
 */
export function buildJobSearchFaqJsonLd(): FaqPageJsonLd | null {
  return buildFaqPageJsonLd([
    {
      question: "How is Intervu different from Indeed and LinkedIn?",
      answer:
        "Unlike Indeed and LinkedIn which allow sponsored reposts, stale third-party feeds, and unmonitored listings, Intervu indexes live jobs directly from employer applicant tracking systems (Greenhouse, Lever, Ashby, Workday, etc.) and actively screens every posting for freshness, salary transparency, and ghost-job risk.",
    },
    {
      question: "What is a ghost job and how does Intervu screen for them?",
      answer:
        "A ghost job is a listing that remains posted indefinitely even when the company is not actively hiring. Intervu monitors posting duration, company hiring velocity, ATS update frequencies, and listing freshness to flag stale or low-signal roles before you waste time applying.",
    },
    {
      question: "Is Intervu free to search for jobs?",
      answer:
        "Yes, searching live jobs, filtering by remote or salary, viewing verified employer track records, and exploring market trends on Intervu is completely free for job seekers.",
    },
    {
      question: "How fresh are the job listings on Intervu?",
      answer:
        "Intervu updates listings directly from company career sites continuously. When an employer closes a role on their career page, it is marked closed on Intervu within 24 hours.",
    },
  ]);
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
    alternateName: [
      "Intervu",
      "Intervu Jobs",
      "Intervu Job Search",
      "Intervu - Indeed & LinkedIn Alternative",
      "Intervu HQ",
    ],
    description:
      "Search live, verified jobs directly from company career pages with ghost-job screening and hiring signals.",
    inLanguage: "en-US",
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
    description:
      "Intervu is an independent job search platform that verifies listings directly against company career pages and screens for ghost jobs.",
    slogan:
      "Live jobs, checked for ghost postings — the transparent alternative to Indeed & LinkedIn",
    knowsAbout: [
      "Job Search",
      "Verified Jobs",
      "Hiring Market Trends",
      "Direct ATS Postings",
      "Ghost Job Detection",
      "Salary Transparency",
      "Career Opportunities",
    ],
    sameAs: ["https://thesubspace.io"],
  };
}

/**
 * Per-employer Organization graph for `/co/[slug]` — distinct from
 * `buildOrganizationJsonLd` above, which describes Intervu itself. `name`
 * must already be the cleaned display name the page renders (`data.name`,
 * `lib/jobs/presentation.ts`'s `displayCompanyName`), not recomputed here, so
 * the structured data can't drift from the H1. `logo` reuses
 * `companyLogoUrl` — the same favicon URL `CompanyLogo` puts in the `<img>`
 * tag — rather than inventing a second logo source; it's always derivable
 * because `CompanyPageData.domain` is never empty.
 */
export function buildCompanyOrganizationJsonLd(input: { name: string; domain: string }): OrganizationJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: `https://${input.domain}`,
    logo: companyLogoUrl(input.domain),
  };
}

/** Site-wide WebApplication graph for interactive search and application tools. */
export function buildWebApplicationJsonLd(): WebApplicationJsonLd {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Intervu Job Search",
    url: siteUrl,
    applicationCategory: "BusinessApplication",
    operatingSystem: "All",
    description:
      "Live job discovery and tracking application verifying listings against employer ATS systems.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Live verified job search",
      "Direct employer career page sync",
      "Ghost-job risk screening",
      "Salary transparency",
      "Application tracker",
      "Resume builder",
    ],
  };
}

interface JobPostingLocation {
  "@type": "Place";
  address: { "@type": "PostalAddress"; addressCountry?: string; addressLocality?: string };
}

interface MonetaryAmountJsonLd {
  "@type": "MonetaryAmount";
  currency: string;
  value: {
    "@type": "QuantitativeValue";
    value?: number;
    minValue?: number;
    maxValue?: number;
    unitText: string;
  };
}

export interface JobPostingJsonLd {
  "@context": "https://schema.org";
  "@type": "JobPosting";
  title: string;
  url: string;
  directApply: false;
  identifier?: { "@type": "PropertyValue"; name: string; value: string };
  hiringOrganization: { "@type": "Organization"; name: string };
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  jobLocation?: JobPostingLocation[];
  jobLocationType?: "TELECOMMUTE";
  applicantLocationRequirements?: JobPostingLocation[];
  baseSalary?: MonetaryAmountJsonLd;
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

function toBaseSalary(job: PublicJob): MonetaryAmountJsonLd | undefined {
  if (job.salary_min == null && job.salary_max == null) return undefined;
  const currency = job.salary_currency || "USD";
  const period = (job.salary_period || "year").toLowerCase();
  const unitText = period === "hour" ? "HOUR" : period === "month" ? "MONTH" : "YEAR";

  const quantValue: MonetaryAmountJsonLd["value"] = {
    "@type": "QuantitativeValue",
    unitText,
  };
  if (job.salary_min != null && job.salary_max != null && job.salary_min === job.salary_max) {
    quantValue.value = job.salary_min;
  } else {
    if (job.salary_min != null) quantValue.minValue = job.salary_min;
    if (job.salary_max != null) quantValue.maxValue = job.salary_max;
  }

  return {
    "@type": "MonetaryAmount",
    currency,
    value: quantValue,
  };
}

/** Every field is omitted when absent — never null, never a placeholder. `directApply`
 *  is false because applying always leaves for the employer's own ATS. */
export function buildJobPostingJsonLd(job: PublicJob, path: string): JobPostingJsonLd {
  const places = toPlaces(job);
  const employmentType = EMPLOYMENT_TYPE_MAP[job.employment_type];
  const closed = job.vacancy_status === "closed";
  const isRemote =
    job.work_type === "remote" ||
    (typeof job.location === "string" && job.location.toLowerCase().includes("remote"));
  const baseSalary = toBaseSalary(job);

  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    url: `${getSiteUrl()}${path}`,
    directApply: false,
    identifier: {
      "@type": "PropertyValue",
      name: job.company ?? "Unlisted employer",
      value: job.id,
    },
    hiringOrganization: { "@type": "Organization", name: job.company ?? "Unlisted employer" },
    ...(job.description ? { description: job.description } : {}),
    ...(job.posted_at ? { datePosted: job.posted_at } : {}),
    ...(closed && job.updated_at ? { validThrough: job.updated_at } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(places ? { jobLocation: places } : {}),
    ...(isRemote ? { jobLocationType: "TELECOMMUTE" as const } : {}),
    ...(isRemote && places ? { applicantLocationRequirements: places } : {}),
    ...(baseSalary ? { baseSalary } : {}),
  };
}

