import { JOBS_INDEX, host, meiliFetch, searchKey } from "./meilisearch";
import type { PublicJob } from "./types";

/**
 * Meilisearch get-document-by-primary-key URL. No filter is involved, so unlike
 * the search path (`searchMeili` / `JobSearchParams.id`) this can also address
 * closed vacancies — required by the closed-state job page.
 */
export function buildJobDocumentUrl(h: string, id: string): string {
  return `${h.replace(/\/+$/, "")}/indexes/${JOBS_INDEX}/documents/${encodeURIComponent(id)}`;
}

/**
 * Reads one job document directly by Meilisearch primary key. Bypasses the
 * search backend's baseline `vacancy_status != "closed"` invariant entirely, so
 * closed jobs are still returned — a plain search-by-id would silently 404 them.
 *
 * A non-404 failure is thrown, never swallowed into `null`: `null` here means
 * "no such job," and collapsing "backend unreachable" into the same value would
 * let a Meili outage read as the whole corpus vanishing (a lying fallback).
 */
export async function getJobById(id: string): Promise<PublicJob | null> {
  const h = host();
  if (!h) return null;

  const res = await meiliFetch(buildJobDocumentUrl(h, id), {
    headers: { authorization: `Bearer ${searchKey()}` },
    // Unlike the search path (always fresh, user-specific), this endpoint's
    // highest-volume caller is crawlers re-fetching the same handful of pages —
    // ISR-cache it so a repeat hit costs nothing (spec §9 load protection).
    next: { revalidate: 3600 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`meili document fetch failed: ${res.status}`);
  return (await res.json()) as PublicJob;
}
