"use server";

import { createApplication } from "@/actions/application";
import { generateGenericJSON } from "@/actions/generate-context";
import { getJobsBackendStatus, getJobsLastUpdated, searchJobs as runSearch, suggestJobs } from "@/lib/jobs/search";
import type { JobSearchParams, JobSearchResult, JobsBackendKind, JobSuggestions } from "@/lib/jobs/types";
import { validate, markJobAppliedSchema } from "@/lib/validation";

/** Search the jobs corpus (dispatches to whichever backend is configured). */
export async function searchJobsAction(params: JobSearchParams): Promise<JobSearchResult> {
  return runSearch(params);
}

/** The corpus's last-updated timestamp, for the "last synced" trust stamp. */
export async function getJobsFreshnessAction(): Promise<string | null> {
  return getJobsLastUpdated();
}

/**
 * Typeahead: title/company suggestions for the search box (Task 9). Never
 * throws — degrades to `{ titles: [], companies: [] }` on any failure so
 * suggestions are purely an accelerant, never a source of user-visible error.
 */
export async function suggestJobsAction(q: string): Promise<JobSuggestions> {
  try {
    return await suggestJobs(q);
  } catch {
    return { titles: [], companies: [] };
  }
}

/**
 * Explore mode: ask the model for ADJACENT roles the candidate is positioned for
 * but might not search themselves. Inherits the login + credit gate from
 * `generateGenericJSON` — auth / out-of-credits surface as sentinel-prefixed
 * `error` strings the client routes to the AuthPopover (see lib/llm/sentinels).
 *
 * Inputs are user-controlled (resume-derived) and flow into an LLM prompt, so
 * they're length-capped to bound prompt size + injection surface.
 */
export async function suggestAdjacentRolesAction(input: {
  profession: string;
  skills: string[];
  seniority?: string | null;
}): Promise<{ titles?: string[]; error?: string }> {
  const profession = (input.profession ?? "").trim().slice(0, 120);
  const skills = (input.skills ?? [])
    .map((s) => String(s ?? "").trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 12);
  const seniority = (input.seniority ?? "").trim().slice(0, 20);

  if (!profession && skills.length === 0) {
    return { error: "Add a profession or skills to your resume to explore adjacent roles." };
  }

  const prompt = `You suggest ADJACENT career roles for a job seeker.

Current role: "${profession || "(not specified)"}"
${seniority ? `Seniority: ${seniority}` : ""}
Skills: ${skills.join(", ") || "(none listed)"}

Return 6 to 8 job titles that are ADJACENT or TANGENTIAL to this background —
roles the person is well-positioned for but might not search for themselves.
Favor lateral moves and reasonable stretches that reuse their skills. Avoid
exact synonyms of their current title, and avoid unrelated fields.

Return ONLY JSON, no prose:
{ "titles": ["Title 1", "Title 2", "Title 3", "Title 4", "Title 5", "Title 6"] }`;

  const result = await generateGenericJSON(prompt);

  // Sentinel-prefixed hard blocks (AUTH_REQUIRED / OUT_OF_CREDITS) arrive here
  // verbatim; pass them through so the client's sentinel UX fires.
  if (result?.error) return { error: result.error };

  const lowerProfession = profession.toLowerCase();
  const titles = (Array.isArray(result?.titles) ? result.titles : [])
    .map((t: unknown) => String(t ?? "").trim())
    .filter((t: string) => t.length > 0 && t.toLowerCase() !== lowerProfession)
    .filter((t: string, i: number, arr: string[]) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)
    .slice(0, 8);

  if (titles.length === 0) return { error: "NO_SUGGESTIONS" };
  return { titles };
}

/** Report which search backend is live, for the UI's connected/empty states. */
export async function jobsBackendStatusAction(): Promise<{
  backend: JobsBackendKind;
  configured: boolean;
  note: string;
}> {
  return getJobsBackendStatus();
}

/**
 * Track a job the user is applying to — the "apply → track" step of the loop.
 * Creates an application row (status "applied") in the user's tracker. Applying
 * itself is a deep-link out to the posting; this records that they did.
 */
export async function markJobAppliedAction(input: {
  company: string;
  title: string;
  applyUrl: string;
}): Promise<{ data?: { id: string }; error?: string }> {
  const parsed = validate(markJobAppliedSchema, input);
  if (!parsed.ok) return { error: parsed.error };

  const res = await createApplication({
    company_name: parsed.data.company,
    position: parsed.data.title,
    job_url: parsed.data.applyUrl,
    status: "applied",
    applied_at: new Date().toISOString(),
  });
  if (res.error) return { error: res.error };
  const id = (res.data as { id?: string } | undefined)?.id ?? "";
  return { data: { id } };
}
