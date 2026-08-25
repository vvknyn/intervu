import { jobPath } from "./job-slug";
import type { PublicJob } from "./types";

/**
 * Pure: a job -> the canonical, indexable job-detail URL
 * (`/jobs/<slug>-<uuid>`, see `jobPath`). One source for a shape two very
 * different callers need byte-identical: the board's `ShareAction` (JobDetail.tsx,
 * client — origin from `window.location.origin`) and the MCP `search_jobs`/
 * `get_job` tools (agent/tools.ts, server — origin from `getSiteUrl()`, the
 * SEO canonical, never `AGENT.issuer()`, which answers a different question
 * and is free to move independently even while the two happen to agree;
 * 2026-08-11 fix. R6, 2026-08-09 — recommending a job in chat with no way to
 * open it on intervu was a founder-reported gap). Previously built `/jobs?job=<id>`
 * (the board's reopen-the-sheet query param); that URL still works as a
 * fallback (`app/jobs/page.tsx` still reads it) but is not indexable, so
 * every caller now gets the real per-job page instead — one URL per job,
 * not two competing for link equity.
 */
export function jobShareUrl(origin: string, job: Pick<PublicJob, "id" | "title" | "company">): string {
  return `${origin.replace(/\/+$/, "")}${jobPath(job)}`;
}
