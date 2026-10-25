import type { CompanyFacts } from "./company-facts";

/** Page order. The page maps each id to one component; presence is decided here only. */
export const SECTION_ORDER = ["identity", "hiringNow", "openRoles", "whereAndHow", "skills", "listingHealth", "filings", "related", "faq"] as const;
export type SectionId = (typeof SECTION_ORDER)[number];

/** What the facts alone do not say: list sizes the page fetched separately. */
export interface SectionExtras {
  roleCount: number;
  relatedCount: number;
  faqCount: number;
}

/** Facts public, nothing invented: a section is present exactly when it has data to state. */
export function companySections(facts: CompanyFacts, extras: SectionExtras): SectionId[] {
  const { hiring, mix, pay, health, filings } = facts;
  const present: Record<SectionId, boolean> = {
    identity: true,
    hiringNow: hiring.openCount > 0 || hiring.lastPostedAt != null || (hiring.cadence?.length ?? 0) > 0,
    whereAndHow: [mix.countries, mix.workType, mix.employmentType, mix.experienceLevel, mix.visaSponsorship, pay].some((f) => f != null),
    skills: mix.skills != null || mix.tech != null,
    listingHealth: health.ghostFlaggedPct != null || health.verdict != null,
    filings: Object.values(filings).some((f) => f != null),
    openRoles: extras.roleCount > 0,
    related: extras.relatedCount > 0,
    faq: extras.faqCount > 0,
  };
  return SECTION_ORDER.filter((id) => present[id]);
}
