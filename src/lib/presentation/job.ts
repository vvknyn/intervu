/**
 * `presentJob`: the chokepoint a raw `PublicJob` (Subspace's pipeline row —
 * see lib/jobs/types.ts's module doc) must pass through before a component
 * renders it. Composes the existing per-field helpers
 * (`lib/jobs/presentation.ts`'s `decodeText`/`locationText`/`salaryText`)
 * with this module's own `presentCompany`/`locationSummary`/
 * `descriptionLede`/`STATUS_VOCABULARY` — no field here is cleaned twice by
 * two different functions.
 *
 * Wired into the `/co/[slug]` role rows via `companyRowMetaSegments` below
 * (ADOPTION.md's wave-3 bullet for that page) — the other call sites listed
 * in ADOPTION.md (SERP `JobCard`, `JobDetail.tsx`, the email digest) are
 * still unwired.
 */
import {
  buildRowMetaLine,
  decodeText,
  employmentTypeSegment,
  locationText,
  locationWithMode,
  LOCATION_UNKNOWN_TEXT,
  salaryText,
  structuredLocationText,
  titleCaseDisplay,
  type RowMetaSegment,
} from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { presentCompany, type PresentedCompany } from "./company";
import { locationSummary } from "./location";
import { descriptionLede } from "./description";
import { GHOST_BADGE_STATUS, STATUS_VOCABULARY, type StatusVocabularyEntry } from "./status";

export interface PresentedJob {
  title: string;
  company: PresentedCompany;
  /** Postal-code-stripped, breadcrumb-collapsed location text — see
   *  `locationSummary` for the rule ladder. */
  location: string;
  /** Clean ~200-char preview text — see `descriptionLede`. */
  descriptionLede: string;
  /** `null` when the corpus carries no salary figures at all. */
  salary: string | null;
  /** `null` for `ghost_badge: "unscored"` — no verdict to state. */
  status: StatusVocabularyEntry | null;
}

/**
 * The place a result card prints: the resolved geo fields ("Calgary,
 * Alberta, Canada") ahead of the posting's raw string ("CA-AB-Calgary-Gulf
 * Canada Square"), which is only used when no field resolved. The raw string
 * belongs in the card's `title`.
 */
export function formatCardPlace(job: PublicJob): string {
  return locationSummary(structuredLocationText(job) || locationText(job));
}

export function presentJob(job: PublicJob): PresentedJob {
  const status = GHOST_BADGE_STATUS[job.ghost_badge];
  return {
    title: titleCaseDisplay(decodeText(job.title)),
    company: presentCompany({ name: job.company, domain: job.company_domain, title: job.title }),
    location: locationSummary(locationText(job)),
    descriptionLede: descriptionLede(job.description),
    salary: salaryText(job),
    status: status ? STATUS_VOCABULARY[status] : null,
  };
}

/**
 * `buildRowMetaLine`'s facts for a company-page role row (salary leads,
 * then location, then employment-type — see `buildRowMetaLine`'s own doc),
 * built through `presentJob` so the location text gets the same
 * `locationSummary` cleanup (postal codes stripped, ATS breadcrumbs
 * clamped) the SERP row already gets — not a second, uncleaned copy of it.
 * Exactly the JobCard construction in app/jobs/page.tsx, minus posted age:
 * neither /co role-row renderer (`CompanyRoleSearch`, `CompanyRolesList`)
 * has ever shown a posted-age fallback, and this factors out what both
 * previously hand-rolled as their own `roleMeta()` — the exact drift this
 * chokepoint replaces.
 */
export function companyRowMetaSegments(job: PublicJob): RowMetaSegment[] {
  const presented = presentJob(job);
  const locationKnown = job.work_type === "remote" || presented.location !== LOCATION_UNKNOWN_TEXT;
  return buildRowMetaLine(
    {
      salary: presented.salary,
      location: locationKnown ? locationWithMode(presented.location, job.work_type) : null,
      employmentType: employmentTypeSegment(job.employment_type),
    },
    null,
  );
}
