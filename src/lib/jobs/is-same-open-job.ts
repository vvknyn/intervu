/**
 * Re-click dedupe chokepoint for `openJob` (jobs/page.tsx). A click on a row
 * that is ALREADY the deliberately-open job is a no-op: every side effect
 * downstream of `openJob` (the description fetch, `recordJobOpenedAction`,
 * `captureEvent("result_clicked")`, `recordJobViewAction`) has already run
 * for this id, so firing them again would just re-dispatch the same
 * telemetry and a redundant detail fetch. `openJob` calls this ONCE, at its
 * top, rather than guarding each side effect individually.
 *
 * `panelOpen` matters on its own, not just `currentId === nextId`: a
 * manually-dismissed sheet (page.tsx's `setDetailSheetOpen(false)` outside
 * the URL-sync effect) can leave `currentId` still naming the last-open job
 * while nothing is actually showing — re-clicking that same row should
 * reopen it, not no-op.
 */
export function isSameOpenJob(currentId: string | null, nextId: string, panelOpen: boolean): boolean {
    return panelOpen && currentId === nextId;
}
