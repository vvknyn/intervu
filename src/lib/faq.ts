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
      "Velai features a dedicated Remote filter and verified work-mode badges. Simply search for your desired role or tech stack (e.g. 'Software Engineer', 'AI Specialist', 'Data Analyst') and select the Remote filter to browse live, vetted work-from-home opportunities worldwide.",
  },
  {
    question: "Are remote jobs verified on Velai?",
    answer:
      "Yes, every remote listing is checked directly against the hiring company's live career portal. Velai records the posting's first-seen date, whether the employer's own page still lists the role, and the location and pay stated on the posting, and marks the role closed once it disappears from that page.",
  },
  {
    question: "What is a ghost job and how does Velai screen for them?",
    answer:
      "A ghost job is a listing that remains posted indefinitely even when the company is not actively hiring. Every posting on Velai shows how long it has been open and when it was last seen live on the employer's career page.",
  },
  {
    question: "Is Velai free to search for jobs?",
    answer:
      "Yes, searching live jobs, filtering by remote or salary, viewing verified employer track records, and exploring market trends on Velai is completely free for job seekers.",
  },
  {
    question: "How fresh are the job listings on Velai?",
    answer:
      "Velai re-checks listings directly against company career sites on an ongoing basis. A role is marked closed once the re-check no longer finds it on the employer's site.",
  },
  {
    question: "Is my résumé private on Velai?",
    answer:
      "Yes. Velai reads your résumé file in your browser and never uploads the file. Without a paid month, your résumé stays in your browser. With one, it is saved to your account encrypted with AES-256. When AI helps read or tailor it, your name and contact details are taken out first and it runs on a sealed server that Velai can't read. Velai has no ads, never sells your data, and its analytics never record the words on your screen or what you type.",
  },
];
