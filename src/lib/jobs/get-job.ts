import { JOBS_INDEX, host, meiliFetch, searchKey } from "./meilisearch";
import { normalizePublicJob } from "./normalize-public-job";
import type { PublicJob } from "./types";

/**
 * Meilisearch search-endpoint URL for the jobs index. Deliberately the
 * `/search` action, not `/documents/<id>` (get-document-by-primary-key):
 * `MEILISEARCH_SEARCH_KEY` is scoped to `search` only — least privilege for a
 * public, crawler-facing route — and 403s against the documents endpoint.
 * `/search` accepts the same key and, filtered to one id (`buildJobIdFilter`),
 * returns the identical single document.
 */
export function buildJobSearchUrl(h: string): string {
  return `${h.replace(/\/+$/, "")}/indexes/${JOBS_INDEX}/search`;
}

/**
 * Meilisearch filter expression isolating one document by primary key.
 * `JSON.stringify` quotes AND escapes the id — same technique `buildFilter`
 * uses for every clause in meilisearch.ts (`id = ${JSON.stringify(p.id)}`) —
 * so a hostile id can't break out of the filter's string literal and inject
 * additional clauses.
 */
export function buildJobIdFilter(id: string): string {
  return `id = ${JSON.stringify(id)}`;
}

/**
 * Reads one job document by Meilisearch primary key via the SEARCH endpoint,
 * not the document-get endpoint (see `buildJobSearchUrl`). The filter carries
 * ONLY `id` — this deliberately does NOT go through `buildFilter`/`searchMeili`,
 * which bake in the baseline `vacancy_status != "closed"` invariant, so closed
 * jobs are still returned here, required by the closed-state job page.
 *
 * A non-2xx response is thrown, never swallowed into `null`: `null` here means
 * "no such job" (zero hits on a successful search), and collapsing "backend
 * unreachable" into the same value would let a Meili outage read as the whole
 * corpus vanishing (a lying fallback).
 */
export async function getJobById(id: string): Promise<PublicJob | null> {
  const h = host();
  if (!h) return null;

  const res = await meiliFetch(buildJobSearchUrl(h), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
    body: JSON.stringify({ q: "", filter: buildJobIdFilter(id), limit: 1 }),
    // Unlike the search path (always fresh, user-specific), this endpoint's
    // highest-volume caller is crawlers re-fetching the same handful of pages —
    // ISR-cache it so a repeat hit costs nothing (spec §9 load protection).
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`meili job search failed: ${res.status}`);
  const body = (await res.json()) as { hits?: (PublicJob & { url?: string | null })[] };
  const hit = body.hits?.[0];
  return hit ? normalizePublicJob(hit) : null;
}

/**
 * Of these ids, the ones no longer open: a document marked closed, or none
 * at all (dropped from the index). Pure, so the rule is tested without Meili.
 */
export function unlistedJobIds(ids: string[], hits: { id: string; vacancy_status?: string | null }[]): string[] {
  const statusById = new Map(hits.map((h) => [h.id, h.vacancy_status ?? null]));
  return ids.filter((id) => !statusById.has(id) || statusById.get(id) === "closed");
}

/**
 * Which saved roles' listings have closed (`unlistedJobIds`), in one read of
 * the same search endpoint `getJobById` uses (it keeps closed documents).
 * A failed read throws, so an outage never reads as every role closing.
 */
export async function listUnlistedJobIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const h = host();
  if (!h) return [];

  const res = await meiliFetch(buildJobSearchUrl(h), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
    body: JSON.stringify({
      q: "",
      filter: `id IN [${ids.map((id) => JSON.stringify(id)).join(", ")}]`,
      limit: ids.length,
      attributesToRetrieve: ["id", "vacancy_status"],
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`meili job status read failed: ${res.status}`);
  const body = (await res.json()) as { hits?: { id: string; vacancy_status?: string | null }[] };
  return unlistedJobIds(ids, body.hits ?? []);
}
