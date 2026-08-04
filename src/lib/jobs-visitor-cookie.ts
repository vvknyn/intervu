/**
 * Returning-searcher memory: middleware stamps this on every `/jobs`
 * request (landing or searching — search happens via query params on that
 * same route), and `/` (the automation-first front door) reads it
 * server-side to show a "go to the job board" bar for people who've been
 * there before. Memory only — never used to auto-redirect. One constant so
 * the writer (`src/middleware.ts`) and reader (`src/app/page.tsx`) can't
 * drift apart on the name or lifetime.
 */
export const JOBS_VISITOR_COOKIE = "sb_jobs_visitor";
export const JOBS_VISITOR_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, in seconds
