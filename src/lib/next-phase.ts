/**
 * True while `next build` is prerendering. THE one copy — extracted after a
 * third caller appeared (market-trends, company-stats, hot-list all need the
 * same "degrade at build, stale-while-error at runtime" split for ISR pages
 * backed by Meilisearch).
 */
export const isBuildPhase = (): boolean =>
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build";
