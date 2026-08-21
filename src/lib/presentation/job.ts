/**
 * `presentJob`: the chokepoint a raw `PublicJob` (Subspace's pipeline row —
 * see lib/jobs/types.ts's module doc) must pass through before a component
 * renders it. Composes the existing per-field helpers
 * (`lib/jobs/presentation.ts`'s `decodeText`/`locationText`/`salaryText`)
 * with this module's own `presentCompany`/`locationSummary`/
 * `descriptionLede`/`STATUS_VOCABULARY` — no field here is cleaned twice by
 * two different functions.
 *
 * Not yet wired into any component (this PR is the module + tests only —
 * see ADOPTION.md for the wave-3 call sites).
 */
import { decodeText, locationText, salaryText } from "@/lib/jobs/presentation";
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

export function presentJob(job: PublicJob): PresentedJob {
  const status = GHOST_BADGE_STATUS[job.ghost_badge];
  return {
    title: decodeText(job.title),
    company: presentCompany({ name: job.company, domain: job.company_domain }),
    location: locationSummary(locationText(job)),
    descriptionLede: descriptionLede(job.description),
    salary: salaryText(job),
    status: status ? STATUS_VOCABULARY[status] : null,
  };
}
