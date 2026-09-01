import { savedSearchId } from "@/lib/jobs/saved-searches";
import { parseJobsUrl } from "@/lib/jobs/url-state";
import type { JobsUrlState } from "@/lib/jobs/url-state";

const MAX_HREF_LENGTH = 2048;

export function validateSearchAlertHref(
  href: string,
): { ok: true; href: string; searchHash: string } | { ok: false } {
  const trimmed = href.trim();
  if (!trimmed || trimmed.length > MAX_HREF_LENGTH) return { ok: false };
  if (trimmed !== "/jobs" && !trimmed.startsWith("/jobs?")) return { ok: false };
  return { ok: true, href: trimmed, searchHash: savedSearchId(trimmed) };
}

/** Parse a validated `/jobs` or `/jobs?…` href into search state for digest queries. */
export function jobsUrlStateFromSearchAlertHref(href: string): JobsUrlState {
  const qs =
    href === "/jobs"
      ? ""
      : href.startsWith("/jobs?")
        ? href.slice("/jobs?".length)
        : href.startsWith("?")
          ? href.slice(1)
          : href;
  return parseJobsUrl(new URLSearchParams(qs));
}
