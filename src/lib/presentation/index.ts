/**
 * Presentation chokepoint — see ADOPTION.md for the wave-3 call sites that
 * will route through this module instead of touching raw `PublicJob`/company
 * fields directly.
 */
export { presentJob, type PresentedJob } from "./job";
export { presentCompany, type PresentedCompany, type CompanyLikeInput } from "./company";
export { locationSummary } from "./location";
export { descriptionLede } from "./description";
export {
  STATUS_VOCABULARY,
  GHOST_BADGE_STATUS,
  type PresentationStatus,
  type StatusVocabularyEntry,
} from "./status";
