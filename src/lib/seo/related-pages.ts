import { BLOG_POSTS, blogPostPath } from "@/lib/blog/posts";

/**
 * Which marketing page points to which: the one place the site's internal link
 * graph is written down for the pages that stood alone (a comparison page linked
 * only to the job board and, for two of the three, one sibling; the research page
 * to two other pages). Each page renders its entry as a "Keep reading" list
 * (`components/seo/RelatedLinks.tsx`), so a reader at the end of one page is
 * offered the pages a person with the same question reads next, and a search
 * engine finds each of them linked from inside page text, with the anchor saying
 * what is behind it.
 *
 * Anchors and blurbs for blog posts come from the post itself, so a renamed post
 * renames its links. Everything else is written here, in the plain words the pages
 * use (this layer may say "ghost job"; page text may not, so these do not).
 *
 * tests/unit/related-pages.test.ts holds the graph to its rules: every target is a
 * real page that answers 200 (never a redirect), links are not repeated or to the
 * page itself, an anchor says what it opens, and a cluster links each other both ways.
 */

export interface RelatedPage {
  href: string;
  /** The link's text: names what it opens (never "click here" or "read more"). */
  label: string;
  /** One sentence under the link saying what a reader finds there. */
  blurb: string;
}

const STATIC: Record<string, RelatedPage> = {
  "/jobs": { href: "/jobs", label: "Search live jobs", blurb: "Roles read from employers' own career pages, with a note on any that look stale." },
  "/trends": { href: "/trends", label: "Market trends", blurb: "Live hiring stats: which countries are hiring and how fresh the postings are." },
  "/about": { href: "/about", label: "About velai", blurb: "What it is, how it works and where the listings come from." },
  "/research/ghost-jobs": { href: "/research/ghost-jobs", label: "How the posting checks work", blurb: "What \"Possibly stale\" and \"Worth verifying\" mean, and what each is based on." },
  "/indeed-alternative": { href: "/indeed-alternative", label: "Indeed alternative", blurb: "Why a listing can outlast its role on a paid board, and what velai shows instead." },
  "/linkedin-jobs-alternative": { href: "/linkedin-jobs-alternative", label: "LinkedIn Jobs alternative", blurb: "Job search with no profile to polish and no Easy Apply pile." },
  "/eluta-alternative": { href: "/eluta-alternative", label: "Eluta alternative", blurb: "The same career-page read, plus freshness flags and employers beyond one regional list." },
};

/** A blog post as a related page: its title as the anchor, its description as the blurb. */
function blogEntry(slug: string): RelatedPage {
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) throw new Error(`related-pages: no blog post "${slug}"`);
  return { href: blogPostPath(post.slug), label: post.title, blurb: post.description };
}

const COMPARISONS = ["/indeed-alternative", "/linkedin-jobs-alternative", "/eluta-alternative"] as const;

/** The pages that have a "Keep reading" list, and the pages each offers (in order). */
export const RELATED_PAGE_PATHS = [...COMPARISONS, "/research/ghost-jobs"] as const;

export function relatedPagesFor(path: string): RelatedPage[] {
  const pick = (...hrefs: string[]) => hrefs.map((href) => STATIC[href] ?? blogEntry(href.replace(/^\/blog\//, "")));
  switch (path) {
    case "/indeed-alternative":
    case "/linkedin-jobs-alternative":
    case "/eluta-alternative":
      return [
        ...pick(...COMPARISONS.filter((c) => c !== path)),
        ...pick("/research/ghost-jobs"),
        blogEntry("is-velai-legit"),
      ];
    case "/research/ghost-jobs":
      return [...pick("/jobs", "/trends"), blogEntry("is-velai-legit"), ...pick("/about")];
    default:
      return [];
  }
}
