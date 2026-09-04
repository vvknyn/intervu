#!/usr/bin/env node
/**
 * SPEC-2-PROFILES.md is not in this repo — see docs/telemetry/SPEC-PROVENANCE.md.
 *
 * Nightly build of `intervu.job_features` — SPEC-2-PROFILES.md §8 step 1.
 *
 * Pages the full live `jobs` Meilisearch corpus (GET /indexes/jobs/documents,
 * the plain-listing endpoint — no relevance ranking and no maxTotalHits cap
 * to page around, unlike /search; see scripts/audit/search-exactness.ts's
 * doc for that cap biting a *different* endpoint), runs every document
 * through the pure extractor (`@/lib/telemetry/features`), and
 * upsert-replaces each job's row in `intervu.job_features`. Re-running this
 * for the same corpus reproduces the same rows (upsert on `job_id`, no
 * counters) — the posting is a live document, not an append-only ledger, so
 * "idempotent" here means "reflects the posting's current text", not
 * "identical output run over run" the way the raw-ledger rollups must be.
 *
 * Connects as `pipeline` (BATCH_PG_URL) — the same role and connection
 * `scripts/reap-telemetry.ts` uses, and the one telemetry-schema.sql names
 * as this table's owner. Never `telemetry_pg`/`TELEMETRY_PG_URL`: that role
 * is insert-only on the raw ledger (telemetry-schema.sql §4) and has no
 * grant on `job_features` at all. Uses a raw `pg.Client` rather than
 * `@/lib/pg/pool` — none of that module's pools fit a box script: its
 * `getExhaustPg()` forces `SET LOCAL default_transaction_read_only = on`
 * for the app's own read paths and this job writes, and it has no
 * `BATCH_PG_URL` accessor at all (only ever used from box scripts, which
 * connect directly, same as `reap-telemetry.ts`).
 *
 * Usage: npx tsx scripts/build-job-features.ts
 */
import { config } from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractJobFeatures, type JobFeatures } from "@/lib/telemetry/features";
import { writeHeartbeat } from "@/lib/telemetry/heartbeat";
import { buildUpsert } from "@/lib/pg/upsert";
import { JOB_FEATURES_COLUMNS } from "@/lib/telemetry/job-features-columns";
import { JOB_DOCUMENT_FIELDS } from "@/lib/telemetry/job-document-fields";
import type { PublicJob } from "@/lib/jobs/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

const JOB_NAME = "build-job-features";
const PAGE_SIZE = 500;

const connectionString = process.env.BATCH_PG_URL;
const meiliUrl = process.env.MEILI_URL;
const meiliAdminKey = process.env.MEILI_ADMIN_KEY;

/** Pure: given a batch of rows, build one parameterized multi-row upsert.
 *  No DB handle involved, so the SQL shape is unit-testable on its own.
 *  Delegates to the shared builder (src/lib/pg/upsert.ts) rather than
 *  building the SQL string here a second time. */
export function buildJobFeaturesUpsert(rows: JobFeatures[]): { text: string; params: unknown[] } {
  return buildUpsert<JobFeatures>("intervu.job_features", JOB_FEATURES_COLUMNS, ["job_id"], rows);
}

/**
 * Restricts the response to exactly `JOB_DOCUMENT_FIELDS` (the fields
 * `extractJobFeatures` actually reads, see that constant's doc comment) via
 * Meili's `&fields=` param, instead of paging full documents and discarding
 * everything the extractor doesn't touch. Measured 2026-09-04 against the
 * live 2,477,990-doc index at 3 offsets: unrestricted pages were 2,415,469 /
 * 2,211,643 / 3,103,416 bytes; the same 3 offsets with `&fields=` were
 * 1,937,387 / 1,790,882 / 2,600,219 bytes — 18.3% less wire, over the
 * 4,956-request walk this loop makes at PAGE_SIZE=500.
 */
async function fetchJobsPage(offset: number, limit: number): Promise<PublicJob[]> {
  const fields = JOB_DOCUMENT_FIELDS.join(",");
  const res = await fetch(
    `${meiliUrl}/indexes/jobs/documents?offset=${offset}&limit=${limit}&fields=${fields}`,
    { headers: { authorization: `Bearer ${meiliAdminKey}` } },
  );
  if (!res.ok) throw new Error(`GET /indexes/jobs/documents?offset=${offset} -> ${res.status}`);
  const body = (await res.json()) as { results: PublicJob[] };
  return body.results;
}

async function main() {
  if (!connectionString) throw new Error("BATCH_PG_URL is not set");
  if (!meiliUrl || !meiliAdminKey) throw new Error("MEILI_URL/MEILI_ADMIN_KEY are not set");

  const db = new pg.Client({ connectionString });
  await db.connect();

  let rowsAffected = 0;
  try {
    const now = Date.now();
    let offset = 0;
    for (;;) {
      const page = await fetchJobsPage(offset, PAGE_SIZE);
      if (page.length === 0) break;

      const features = page.map((job) => extractJobFeatures(job, now));
      const { text, params } = buildJobFeaturesUpsert(features);
      await db.query(text, params);
      rowsAffected += features.length;

      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    await writeHeartbeat(db, JOB_NAME, rowsAffected, true);
    console.log(`${JOB_NAME}: wrote ${rowsAffected} row(s)`);
  } catch (err) {
    // Report the real count reached before the failure, never a fabricated
    // one — a heartbeat that lies about rows_affected is worse than none.
    await writeHeartbeat(db, JOB_NAME, rowsAffected, false).catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
