/**
 * Jobs sync logic (J3) — ingest Subspace's read-only feed into intervu's own
 * Meilisearch index. This is the core algorithm; a thin worker wraps it.
 *
 * SERVER-ONLY, and intended to run off the web app: a long-lived worker / cron
 * box, NOT a serverless function, and NOT co-hosted on Subspace infra. A
 * serverless function can't host the reconciliation loop (it's short-lived
 * by design). Requires SUBSPACE_API_KEY + MEILISEARCH_* env.
 * See docs/intervu-jobs-api.md → "Sync algorithm".
 *
 * Recommended cadence:
 *   - initialLoad()      once, on first provision (or full rebuild)
 *   - syncChanged()      every ~1 min, since = lastWatermark − 2 min overlap
 *   - reconcileAndEvict() hourly, to drop closed/hard-deleted jobs that
 *                         /changed does NOT carry
 */
import { iterateChanged, iterateSnapshot } from "./subspaceJobs";
import { allIndexedIds, applyIndexSettings, deleteJobs, upsertJobs } from "./meilisearch";

/** Apply index settings, then bulk-load the full snapshot. Returns rows upserted. */
export async function initialLoad(opts: { limit?: number } = {}): Promise<number> {
  await applyIndexSettings();
  let n = 0;
  for await (const page of iterateSnapshot({ limit: opts.limit ?? 1000 })) {
    await upsertJobs(page);
    n += page.length;
  }
  return n;
}

/** Upsert everything changed at/after `since` (idempotent). Returns rows upserted. */
export async function syncChanged(since: string, opts: { limit?: number } = {}): Promise<number> {
  let n = 0;
  for await (const page of iterateChanged({ since, limit: opts.limit ?? 1000 })) {
    await upsertJobs(page);
    n += page.length;
  }
  return n;
}

/**
 * Walk the full snapshot, collect the live id set, refresh in passing, then evict
 * index entries no longer present — handles closures + 30-day hard-deletes, which
 * `/changed` does not carry. Returns counts of live + evicted ids.
 */
export async function reconcileAndEvict(
  opts: { limit?: number } = {},
): Promise<{ live: number; evicted: number }> {
  const live = new Set<string>();
  for await (const page of iterateSnapshot({ limit: opts.limit ?? 1000 })) {
    for (const j of page) {
      if (j.id) live.add(j.id);
    }
    await upsertJobs(page); // keep the index fresh while we're paging (idempotent)
  }
  const indexed = await allIndexedIds();
  const stale: string[] = [];
  for (const id of indexed) {
    if (!live.has(id)) stale.push(id);
  }
  await deleteJobs(stale);
  return { live: live.size, evicted: stale.length };
}
