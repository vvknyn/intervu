"use server";

/**
 * ITEM O-FE (2026-08-15, Vivek-approved; anonymous reports allowed 2026-09-28) — user-facing
 * "Report listing" writes to Subspace's flags endpoint
 * (`POST /api/v1/flags`). Same `x-api-key` header convention every other
 * Subspace `/api/v1/*` client in this repo uses (see subspaceJobs.ts's
 * doc comment) — a dedicated `INTERVU_FLAGS_API_KEY` rather than reusing
 * `SUBSPACE_API_KEY`, since this is a write endpoint from the public app,
 * not the read-only pipeline sync client.
 *
 * ENV-GATED ROLLOUT: the endpoint isn't deployed yet. `reportJobEnabledAction`
 * is the single source callers probe before rendering the button at all —
 * absent env means "render nothing", never a dead button (see
 * ReportJobButton's mount sites).
 */

import { getServerUser } from "@/lib/auth/server-user";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowReportListingRequest } from "@/lib/shield/rate-limit";
import { resolveReporterKey } from "@/lib/jobs/reporter-key";

/** Plain-language radio label the dialog shows. */
export type ReportJobReason =
  | "dead_link"
  | "filled"
  | "misleading"
  | "ghost_job"
  | "spam"
  | "other";

/**
 * Plain-language reason → schema vocabulary. The ONE place this mapping
 * lives — the dialog never sends its own label text as the reason.
 */
const REASON_SCHEMA: Record<ReportJobReason, string> = {
  dead_link: "expired",
  filled: "expired",
  misleading: "misleading",
  ghost_job: "ghost_job",
  spam: "spam",
  other: "other",
};

export type ReportJobResult =
  | { kind: "ok" }
  | { kind: "already_reported" }
  | { kind: "rate_limited" }
  | { kind: "error"; message: string };

function flagsApiConfig(): { url: string; key: string } | null {
  const url = process.env.INTERVU_FLAGS_API_URL;
  const key = process.env.INTERVU_FLAGS_API_KEY;
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

/** Whether the flags endpoint is deployed — probed once client-side so the
 *  button can render nothing instead of existing-but-broken. */
export async function reportJobEnabledAction(): Promise<boolean> {
  return flagsApiConfig() !== null;
}

export async function reportJobAction(input: {
  jobUrl: string;
  jobTitle: string;
  reason: ReportJobReason;
  notes: string;
}): Promise<ReportJobResult> {
  const config = flagsApiConfig();
  if (!config) return { kind: "error", message: "Reporting isn't available yet." };

  // No account needed. The write chokepoint is the per-IP limiter here plus
  // the flags endpoint's own per-key daily cap and (job_url, reporter_key)
  // uniqueness; the key is derived server-side (`resolveReporterKey`).
  const user = await getServerUser();
  const ip = await getClientIp();
  const reporterKey = resolveReporterKey(user?.uid ?? null, ip, config.key);
  if (!reporterKey) return { kind: "error", message: "We couldn't verify this request. Try again shortly." };
  if (!allowReportListingRequest(ip)) return { kind: "rate_limited" };

  // "dead-link: " prefix on notes distinguishes the two plain-language
  // reasons that both map onto the schema's single "expired" value.
  const notes = input.reason === "dead_link" ? `dead-link: ${input.notes}` : input.notes;

  let res: Response;
  try {
    res = await fetch(`${config.url}/api/v1/flags`, {
      method: "POST",
      headers: { "x-api-key": config.key, "content-type": "application/json" },
      body: JSON.stringify({
        job_url: input.jobUrl,
        job_title: input.jobTitle,
        reason: REASON_SCHEMA[input.reason],
        notes,
        reporter_key: reporterKey,
      }),
    });
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : "Network error." };
  }

  if (res.status === 429) return { kind: "rate_limited" };

  const body: { already_reported?: boolean; error?: string } = await res.json().catch(() => ({}));
  if (body.already_reported === true) return { kind: "already_reported" };
  if (!res.ok) return { kind: "error", message: body.error ?? `Report failed (${res.status}).` };
  return { kind: "ok" };
}
