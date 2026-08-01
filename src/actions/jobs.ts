"use server";

import { createApplication, upsertPursuitForJob } from "@/actions/application";
import { generateGenericJSON } from "@/actions/generate-context";
import {
  getJobsBackendStatus,
  getJobsLastUpdated,
  isPostedDateFilterSupported,
  searchJobs as runSearch,
  suggestJobs,
  type SearchServeMeta,
} from "@/lib/jobs/search";
import type { JobSearchParams, JobSearchResult, JobsBackendKind, JobSuggestions } from "@/lib/jobs/types";
import {
  buildJobOpenEntry,
  buildSearchLogEntry,
  recordJobOpen,
  recordSearch,
  shouldLogSearch,
} from "@/lib/jobs/search-log";
import { validate, markJobAppliedSchema } from "@/lib/validation";
import { randomUUID } from "node:crypto";
import { after } from "next/server";

/**
 * Search the jobs corpus (dispatches to whichever backend is configured).
 *
 * Also emits one anonymous telemetry event per human search. The entry is
 * built on the request (pure, cheap, and stamped with the search's own clock)
 * but WRITTEN via `after()`, so Firestore never sits on the response path and
 * a slow or broken log can't cost the searcher a millisecond.
 */
export async function searchJobsAction(
  params: JobSearchParams,
): Promise<JobSearchResult & { searchId: string; meta?: SearchServeMeta }> {
  const result = await runSearch(params);
  const searchId = randomUUID();

  if (shouldLogSearch(params)) {
    const entry = buildSearchLogEntry(params, result, { searchId, now: Date.now() });
    after(() => recordSearch(entry));
  }

  return { ...result, searchId };
}

/**
 * Record that a searcher opened a result, and where it sat in the list.
 *
 * `rank` is the point of the whole exercise: what people type tells us what
 * they want, but only which position they open tells us whether we answered.
 * Fire-and-forget — never awaited by the UI, never able to fail an open.
 */
export async function recordJobOpenedAction(
  searchId: string,
  jobId: string,
  rank: number,
): Promise<void> {
  if (!searchId || !jobId || !Number.isFinite(rank) || rank < 0) return;
  const entry = buildJobOpenEntry(searchId, String(jobId).slice(0, 128), rank, Date.now());
  after(() => recordJobOpen(entry));
}

/** The corpus's last-updated timestamp, for the "last synced" trust stamp. */
export async function getJobsFreshnessAction(): Promise<string | null> {
  return getJobsLastUpdated();
}

/**
 * Whether the corpus can support the posted-date buckets. The rail and the
 * mobile chip hide the control when it can't, rather than offering a filter
 * that returns an empty board.
 */
export async function getPostedDateFilterSupportAction(): Promise<boolean | null> {
  return isPostedDateFilterSupported();
}

/**
 * Typeahead: title/company suggestions for the search box (Task 9). Never
 * throws — degrades to `{ titles: [], companies: [] }` on any failure so
 * suggestions are purely an accelerant, never a source of user-visible error.
 * Input capped at 200 chars, matching the neighboring `suggestAdjacentRolesAction`'s
 * posture toward user-controlled text reaching a server action.
 */
export async function suggestJobsAction(q: string): Promise<JobSuggestions> {
  try {
    return await suggestJobs((q ?? "").slice(0, 200));
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
 * Creates/advances the pursuit (stage "applied") in the user's tracker.
 * Applying itself is a deep-link out to the posting; this records that they
 * did. Generalizes onto the same find-or-create-by-job_id chokepoint
 * `goAfterJobAction` uses (`upsertPursuitForJob`) when the caller has a
 * `jobId` — so marking a job the user already went after applied advances
 * that same pursuit instead of creating a second row. `jobId` is optional so
 * a caller without one (predating the pursuit job_id linkage) still gets
 * the original plain-create behavior.
 */
export async function markJobAppliedAction(input: {
  company: string;
  title: string;
  applyUrl: string;
  jobId?: string;
}): Promise<{ data?: { id: string }; error?: string }> {
  const parsed = validate(markJobAppliedSchema, input);
  if (!parsed.ok) return { error: parsed.error };

  if (parsed.data.jobId) {
    const res = await upsertPursuitForJob(
      {
        job_id: parsed.data.jobId,
        title: parsed.data.title,
        company: parsed.data.company,
        location: null,
        description: null,
        apply_url: parsed.data.applyUrl ?? "",
      },
      "applied",
    );
    if (res.error) return { error: res.error };
    return { data: { id: res.data!.id } };
  }

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
