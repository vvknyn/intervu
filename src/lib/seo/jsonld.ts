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
import { JOB_SEARCH_FAQ } from "@/lib/faq";
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
  image?: string[];
  author?: ArticleAuthor;
  inLanguage: "en";
  publisher: { "@type": "Organization"; name: string; url: string; logo: { "@type": "ImageObject"; url: string } };
  mainEntityOfPage: { "@type": "WebPage"; "@id": string };
}

interface BreadcrumbJsonLd {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: { "@type": "ListItem"; position: number; name: string; item: string }[];
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
 * and listing verification. Q/A content lives in `JOB_SEARCH_FAQ`
 * (`lib/faq.ts`) — the same array also feeds the visible "Questions" section
 * on the about page, so this is a thin JSON-LD wrapper, not a second copy.
 */
export function buildJobSearchFaqJsonLd(): FaqPageJsonLd | null {
  return buildFaqPageJsonLd(JOB_SEARCH_FAQ);
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
  /** Site path of the article's main picture, e.g. "/blog/x/cover.png". */
  image?: string;
  author?: ArticleAuthor;
}

/** Always an organization (Velai itself): the site names no person who works on it. */
export type ArticleAuthor = { "@type": "Organization"; name: string; url: string };

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
    ...(input.image ? { image: [`${siteUrl}${input.image}`] } : {}),
    ...(input.author ? { author: input.author } : {}),
    inLanguage: "en",
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: siteUrl,
      logo: { "@type": "ImageObject", url: `${siteUrl}/icon-512.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}

/** Breadcrumb trail for search results ("velai.app › Blog › Post"). `path`s are site paths. */
export function buildBreadcrumbJsonLd(items: { name: string; path: string }[]): BreadcrumbJsonLd {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${siteUrl}${item.path}`,
    })),
  };
}

/** Site-wide WebSite graph with a SearchAction pointed at the jobs search
 *  root (`/jobs?q=`) — the query intervu's own search box already runs. */
export function buildWebsiteJsonLd(): WebsiteJsonLd {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    url: siteUrl,
    name: SITE_NAME,
    alternateName: ["Velai.app", "Velai", "Velai Jobs"],
    description:
      "Search live, verified jobs from company career pages with ghost-job screening and hiring signals.",
    inLanguage: "en",
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/jobs?q={search_term_string}`,
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
      "Velai.app is an independent job search at velai.app that reads listings from employer career pages and screens for ghost jobs.",
    slogan:
      "Live jobs, checked for ghost postings — the transparent alternative to Indeed & LinkedIn",
    knowsAbout: [
      "Job Search",
      "Remote Jobs",
      "Best Remote Jobs",
      "Work From Home Jobs",
      "Verified Jobs",
      "Hiring Market Trends",
      "Direct ATS Postings",
      "Ghost Job Detection",
      "Salary Transparency",
      "Career Opportunities",
    ],
  };
}

/** The graphs every page may carry: who the site is. Page-specific graphs
 *  (WebApplication, FAQPage, ...) belong to the page whose content they describe. */
export function buildSiteJsonLd(): (WebsiteJsonLd | OrganizationJsonLd)[] {
  return [buildWebsiteJsonLd(), buildOrganizationJsonLd()];
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
export function buildCompanyOrganizationJsonLd(input: {
  name: string;
  domain: string;
  knowsAbout?: string[];
}): OrganizationJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: `https://${input.domain}`,
    logo: companyLogoUrl(input.domain),
    ...(input.knowsAbout && input.knowsAbout.length > 0 ? { knowsAbout: input.knowsAbout } : {}),
  };
}

/** Site-wide WebApplication graph for interactive search and application tools. */
export function buildWebApplicationJsonLd(): WebApplicationJsonLd {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Velai Job Search",
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
