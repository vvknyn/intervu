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

/**
 * Which source's `descriptionPending` flag applies to the job actually
 * rendered in the detail pane (jobs/page.tsx's `detailJob`), regardless of
 * whether that job arrived via a SERP row's on-demand hydrate or the
 * direct-open (`/jobs?job=<id>`) existence check — both fetches carry a
 * `descriptionPending` flag, and whichever one produced `detailJob` supplies
 * it. `hydrated` wins when present because it's always the MOST RECENT fetch
 * for that id (initial hydrate or a "try again" retry); `found` is the
 * existence check's own answer, used until a hydrate for the same id lands.
 */
export function resolveDetailDescriptionPending(i: {
  detailId: string | null;
  hydrated: { id: string; pending: boolean } | null;
  found: { id: string; pending: boolean } | null;
}): boolean {
  if (i.detailId != null && i.hydrated?.id === i.detailId) return i.hydrated.pending;
  if (i.detailId != null && i.found?.id === i.detailId) return i.found.pending;
  return false;
}
