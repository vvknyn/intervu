/**
 * Latest-intent guard for the sort menu's async "Rank by fit" path.
 *
 * `handleRankByFit` (src/app/jobs/page.tsx) awaits `resolveUsableResume()`
 * (a network round-trip) before applying the résumé-derived query. Without
 * a guard, a user who picks a DIFFERENT sort — or clicks "Rank by fit" again
 * — while that fetch is still in flight would have the stale, now-superseded
 * fetch silently overwrite their newer choice once it finally resolves
 * (review fix, 2026-07-18).
 *
 * `begin()` must be called for EVERY sort-menu selection (fit or otherwise),
 * not just fit clicks, so any other choice also supersedes an in-flight fit
 * resolution. Mirrors `JobsPaginationGeneration`'s monotonic-generation
 * shape (lib/jobs/pagination-generation.ts) at a much smaller scope: one
 * counter, no ticket bookkeeping, since there's nothing here to invalidate
 * except "is my token still the latest."
 */
export class FitIntentGuard {
    private generation = 0;

    /** Issue a fresh token, superseding any token issued before it. */
    begin(): number {
        this.generation += 1;
        return this.generation;
    }

    /** True while `token` is still the most recently issued one. */
    isCurrent(token: number): boolean {
        return token === this.generation;
    }
}
