/**
 * Pure, zero-I/O agent facet vocabularies — split out of `tools.ts` so client
 * components (e.g. the Settings page's agent-preferences card,
 * `AgentPreferencesSection.tsx`) can import these without pulling in
 * `tools.ts`'s server-only dependency graph (Firebase Admin SDK via
 * `pursuits/resume-version.ts`), which Turbopack otherwise drags into the
 * client bundle whole.
 */

/**
 * Real, user-selectable `experience_level` facet values (Task 12), extended
 * to the full live corpus vocabulary 2026-08-08 (measured: lead 121,232 ·
 * executive 94,447 · intern 25,919 postings were previously unfilterable).
 * resume-match.ts:32's `Seniority` union stays its own narrower
 * entry|mid|senior — a DIFFERENT concern (years-of-experience inference for
 * résumé matching, not the job posting's own tagged facet value) that this
 * change deliberately leaves alone. The corpus's own "unknown" sentinel
 * (types.ts:30's doc comment) is excluded here too: FilterPanel.tsx's
 * `SENTINEL_VALUES` already keeps it out of every UI-rendered filter chip,
 * so it is never a value a person — or now an agent — actually picks.
 */
export const EXPERIENCE_LEVELS = ["entry", "mid", "senior", "lead", "executive", "intern"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/** Canonical `work_type` facet values — same vocabulary as query-understanding.ts. */
export const WORK_TYPES = ["remote", "hybrid", "onsite"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

/**
 * Real, user-selectable `employment_type` facet values (Task 12) —
 * types.ts:28's doc comment; full_time|contract|part_time|internship.
 * "unknown" excluded for the same reason as `EXPERIENCE_LEVELS` above.
 */
export const EMPLOYMENT_TYPES = ["full_time", "contract", "part_time", "internship"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/**
 * The ONE `postedWithinDays` value set — shared by `tools.ts`'s
 * `POSTED_WITHIN_DAYS_TO_BUCKET` (its `Record` key type), route.ts's
 * `postedWithinDaysSchema` (the wire schema `search_jobs`/`set_preferences`
 * both validate against), and the settings card's "Posted within" dropdown —
 * so none of the three can drift from the others.
 */
export const POSTED_WITHIN_DAYS_OPTIONS = [7, 30, 90] as const;
export type PostedWithinDays = (typeof POSTED_WITHIN_DAYS_OPTIONS)[number];
