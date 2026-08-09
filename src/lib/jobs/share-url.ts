/**
 * Pure: a job's id -> the URL intervu's own board resolves back to that
 * job's detail sheet (`/jobs?job=<id>`, `app/jobs/page.tsx` reads this exact
 * `job` query param to reopen it). One source for a shape two very
 * different callers need byte-identical: `CopyJobLinkButton` (JobDetail.tsx,
 * client — origin from `window.location.origin`) and the MCP `search_jobs`/
 * `get_job` tools (agent/tools.ts, server — origin from `AGENT.issuer()`,
 * R6, 2026-08-09 — recommending a job in chat with no way to open it on
 * intervu was a founder-reported gap).
 */
export function jobShareUrl(origin: string, jobId: string): string {
  return `${origin.replace(/\/+$/, "")}/jobs?job=${encodeURIComponent(jobId)}`;
}
