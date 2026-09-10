/**
 * Pure resolver for the "About this role" section's render state — the
 * single source of truth JobDetail's description switch reads (see
 * writing-lean-code rule 2: one place decides, everything else reads).
 */
export type DescriptionSectionState = "body" | "loading" | "pending" | "empty";

/** How long the "loading" state must persist before JobDetail shows the
 *  "Fetching the full description…" status line under the skeleton. */
export const DESCRIPTION_SLOW_HINT_MS = 1_500;

/**
 * hydrated = job.description !== undefined (the SERP list-scope stub has no
 *   `description` key at all — distinct from a hydrated job that genuinely
 *   has no description);
 * hasBlocks = formatDescription(job.description).length > 0;
 * pending   = the hydrate response said the live fill is still running
 *   (searchJobsAction's `descriptionPending`).
 */
export function resolveDescriptionSectionState(i: {
  hydrated: boolean;
  hasBlocks: boolean;
  pending: boolean;
}): DescriptionSectionState {
  if (i.hasBlocks) return "body";
  if (!i.hydrated) return "loading";
  if (i.pending) return "pending";
  return "empty";
}
