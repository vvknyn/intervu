/**
 * Typed JSON-LD builders for the pages that need structured data.
 *
 * Each builder is a pure function: given the data a page already fetched
 * (never a fresh query of its own), it returns a plain schema.org object or
 * `null` when the page doesn't have enough to say anything truthful — never
 * a fabricated placeholder. Callers render the result with `serializeJsonLd`
 * inside a `<script type="application/ld+json">` tag.
 */
import { SITE_NAME, SITE_URL } from "./constants";

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
  /** Live open-role count for this company. Always a number (possibly 0) —
   *  the "is X hiring?" question can always be answered honestly. */
  openCount: number;
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
      answer:
        input.openCount > 0
          ? `Yes — intervu currently tracks ${input.openCount} live, verified open role${input.openCount === 1 ? "" : "s"} at ${input.companyName}.`
          : `intervu isn't tracking any live open roles at ${input.companyName} right now.`,
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
  const url = `${SITE_URL}${input.path}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    ...(input.description ? { description: input.description } : {}),
    url,
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}

/** Site-wide WebSite graph with a SearchAction pointed at the jobs search
 *  root (`/?q=`) — the query intervu's own search box already runs. */
export function buildWebsiteJsonLd(): WebsiteJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    url: SITE_URL,
    name: SITE_NAME,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}
