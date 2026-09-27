import type { FaqItem } from "./jsonld";

/**
 * Titles / descriptions / FAQ for the two competitor-alternative pages.
 * Lives in the SEO layer so meta and JSON-LD may use the search term
 * "ghost job"; the page bodies in `app/` must not (plain-language.test.ts).
 */
export const INDEED_ALTERNATIVE = {
  path: "/indeed-alternative",
  title: "Velai — Indeed alternative that reads the career page",
  description:
    "Velai is an Indeed alternative that pulls jobs from employer career pages, not ads. Listings leave when the company closes them. Screened for stale and ghost-job risk.",
} as const;

export const LINKEDIN_JOBS_ALTERNATIVE = {
  path: "/linkedin-jobs-alternative",
  title: "Velai — LinkedIn Jobs alternative, no profile required",
  description:
    "Velai is a LinkedIn Jobs alternative with no profile to polish and no Easy Apply pile. Jobs come from the company's career page and get screened for ghost-job risk.",
} as const;

export const ELUTA_ALTERNATIVE = {
  path: "/eluta-alternative",
  title: "Velai — Eluta alternative that reads the career page",
  description:
    "Velai is an Eluta alternative: jobs read from employer career pages, screened for freshness. Same career-page source class as Eluta, with stale-posting flags and listings beyond a single regional catalog.",
} as const;

export const INDEED_ALTERNATIVE_FAQ: FaqItem[] = [
  {
    question: "Is Velai an Indeed alternative?",
    answer:
      "Velai is a job search that reads employer career pages instead of Indeed's ad marketplace. Listings leave when the company closes them on their own site, usually within a day.",
  },
  {
    question: "Where do Velai's Indeed-alternative listings come from?",
    answer:
      "Directly from company career pages (Greenhouse, Lever, Ashby, Workday, and other hiring systems). Not from paid ads or resold feeds.",
  },
  {
    question: "Does Velai screen for ghost jobs the way Indeed does not?",
    answer:
      "A ghost job is a listing that stays posted when nobody is hiring against it. Velai flags stale and low-signal roles from posting age and update activity. Indeed's sponsored listings can stay visible for as long as someone pays.",
  },
  {
    question: "Is Velai free if I am leaving Indeed?",
    answer:
      "Searching jobs on Velai is free. Match receipts are based strictly on qualifications and skills, with zero paid ranking bumps.",
  },
];

export const ELUTA_ALTERNATIVE_FAQ: FaqItem[] = [
  {
    question: "Is Velai an Eluta alternative?",
    answer:
      "Velai reads employer career pages the way Eluta crawls company sites — but also covers employers outside a single regional index and flags listings that look stale on the source page.",
  },
  {
    question: "How is Velai different from Eluta?",
    answer:
      "Eluta focuses on one regional employer-site directory. Velai uses the same class of read — the company's own hiring page — and adds freshness screening plus career pages wherever the employer publishes them.",
  },
  {
    question: "Should I use Eluta or Velai?",
    answer:
      "Keep Eluta if you want a familiar regional directory built around employer websites. Use Velai when you also want stale-posting flags and the same career-page read for roles beyond that catalog.",
  },
];

export const LINKEDIN_JOBS_ALTERNATIVE_FAQ: FaqItem[] = [
  {
    question: "Is Velai a LinkedIn Jobs alternative?",
    answer:
      "Velai shows jobs from employer career pages. It has no profile, no Open to Work banner, and no Easy Apply. LinkedIn Jobs sits on a social network; Velai does not.",
  },
  {
    question: "Why use Velai instead of LinkedIn Easy Apply?",
    answer:
      "Easy Apply sends your profile into a pile. The listing may be an evergreen recruiter req. Velai only shows what is still on the company's own career page, and screens it for ghost-job risk.",
  },
];
