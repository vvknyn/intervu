import type { FaqItem } from "@/lib/seo/jsonld";

/**
 * High-intent job-search FAQ — searcher questions about how Velai compares
 * to traditional boards (Indeed, LinkedIn), remote-work verification, ghost
 * jobs, cost, and freshness. Single source of truth: feeds both the FAQPage
 * JSON-LD (`buildJobSearchFaqJsonLd`, `lib/seo/jsonld.ts`) and the visible
 * "Questions" section on the about page (`app/about/page.tsx`) so the copy
 * search engines see and the copy people read are always the same text.
 */
export const JOB_SEARCH_FAQ: FaqItem[] = [
  {
    question: "How is Velai different from Indeed and LinkedIn?",
    answer:
      "Unlike Indeed and LinkedIn which allow sponsored reposts, stale third-party feeds, and unmonitored listings, Velai indexes live jobs directly from employer applicant tracking systems (Greenhouse, Lever, Ashby, Workday, etc.) and actively screens every posting for freshness, salary transparency, and ghost-job risk.",
  },
  {
    question: "How do I find the best remote and work-from-home jobs on Velai?",
    answer:
      "Velai features a dedicated Remote filter and verified work-mode badges. Simply search for your desired role or tech stack (e.g. 'Software Engineer', 'AI Specialist', 'Data Analyst') and select the Remote filter to browse live, vetted work-from-home opportunities across Canada, the US, and worldwide.",
  },
  {
    question: "Are remote jobs in Canada and the United States verified on Velai?",
    answer:
      "Yes, every remote listing is verified directly against the hiring company's live career portal. Velai checks hiring activity, location eligibility, and compensation bands so Canadian, American, and international candidates apply only to genuine openings.",
  },
  {
    question: "What is a ghost job and how does Velai screen for them?",
    answer:
      "A ghost job is a listing that remains posted indefinitely even when the company is not actively hiring. Velai monitors posting duration, company hiring velocity, ATS update frequencies, and listing freshness to flag stale or low-signal roles before you waste time applying.",
  },
  {
    question: "Is Velai free to search for jobs?",
    answer:
      "Yes, searching live jobs, filtering by remote or salary, viewing verified employer track records, and exploring market trends on Velai is completely free for job seekers.",
  },
  {
    question: "How fresh are the job listings on Velai?",
    answer:
      "Velai updates listings directly from company career sites continuously. When an employer closes a role on their career page, it is marked closed on Velai within 24 hours.",
  },
];
