#!/usr/bin/env node
/**
 * STAGED rankingRules change for the search-quality wave (2026-08-11).
 * DRY RUN BY DEFAULT — prints current vs proposed and exits. Applying
 * requires an explicit --apply, because a settingsUpdate on this index
 * BLOCKS THE DOCUMENT QUEUE while it runs (measured from task history:
 * uid 433623, rankingRules only = ~24 min; uid 389556, rankingRules +
 * stopWords = ~73 min). Cheap next to the embedder's 9.1h, never free.
 *
 *   node scripts/apply-ranking-rules-v2.mjs                  # dry run (default)
 *   node scripts/apply-ranking-rules-v2.mjs --phase=b --apply
 *   node scripts/apply-ranking-rules-v2.mjs --rollback --apply
 *
 * Env: MEILISEARCH_HOST + MEILISEARCH_ADMIN_KEY (or MEILI_URL/MEILI_ADMIN_KEY).
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 * `exactness` has an ExactAttribute tier: query == whole attribute outranks
 * query ⊂ attribute, absolutely. Measured live 2026-08-11, top tier depth:
 * "product manager" 1,073 · "software engineer" 2,238 · "data analyst" 512 ·
 * "registered nurse" 4,037. Every specific title is gated below all of them.
 *
 * ── ORDERING IS STRICTLY LEXICOGRAPHIC ─────────────────────────────────────
 * Moving `exactness` merely below `sort` does NOT lift the gate: it still
 * decides before `posted_ts`. To stop it gating, it must sit AFTER whichever
 * rule should decide the plateau. Hence it goes LAST below.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

/** Live order, verified 2026-08-11. --rollback restores exactly this. */
const CURRENT = ["words", "typo", "proximity", "attributeRank", "wordPosition", "exactness", "sort", "posted_ts:desc"];

/**
 * PHASE A — exactness demoted below posted_ts. Removes the tier gate with no
 * new document field.
 * ⚠️ DO NOT SHIP ALONE. With the gate gone the plateau is ordered by
 * `posted_ts` — i.e. by date, which is the outcome we were told not to trade
 * for. Measured by read-only simulation over a live 3–6k pool, specific
 * titles reaching the top-10: "registered nurse" 10/10 but "software
 * engineer" only 1/10 and "product manager" 3/10. It swings on which rows
 * happened to be re-stamped, and `posted_at` is re-stamped >30d after
 * first_seen on 66/400 sampled rows. Kept here only as the rollback-forward
 * step if Phase B's field is delayed.
 */
const PHASE_A = ["words", "typo", "proximity", "attributeRank", "wordPosition", "sort", "posted_ts:desc", "exactness"];

/**
 * PHASE B — the intended end state. Orders the relevance plateau by employer
 * hiring ACTIVITY (a fact carried on the document) before falling back to
 * recency, with exactness last as a pure tiebreak.
 *
 * REQUIRES `company_opened_90d` present and numeric on documents. Meili sorts
 * missing values last, so while the sync backfills, un-backfilled listings
 * sink — apply only once coverage is high, and measure coverage first.
 *
 * ⚠️ UNVALIDATED TIEBREAKER: high `company_opened_90d` means "opens many
 * roles", which is ALSO what staffing agencies and job-spam aggregators do
 * (Mrinetwork, one of the offenders in the original report, is a recruiting
 * agency). Before applying, check whether pairing it with
 * `company_closed_90d` (churn) discriminates better. Do not assume this
 * ordering is an improvement — measure it on the live pool the same way
 * Phase A was measured.
 */
const PHASE_B = [
  "words",
  "typo",
  "proximity",
  "attributeRank",
  "wordPosition",
  "sort",
  "company_opened_90d:desc",
  "posted_ts:desc",
  "exactness",
];

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const rollback = argv.includes("--rollback");
const phase = (argv.find((a) => a.startsWith("--phase="))?.split("=")[1] ?? "b").toLowerCase();
const payload = rollback ? CURRENT : phase === "a" ? PHASE_A : PHASE_B;
const label = rollback ? "ROLLBACK (restore current live order)" : `PHASE ${phase.toUpperCase()}`;

const HOST = (process.env.MEILISEARCH_HOST ?? process.env.MEILI_URL ?? "").replace(/\/+$/, "");
const ADMIN = process.env.MEILISEARCH_ADMIN_KEY ?? process.env.MEILI_ADMIN_KEY ?? "";
const READ = process.env.MEILISEARCH_SEARCH_KEY ?? ADMIN;

async function liveRules() {
  if (!HOST || !READ) return null;
  const res = await fetch(`${HOST}/indexes/jobs/settings/ranking-rules`, {
    headers: { authorization: `Bearer ${READ}` },
  });
  return res.ok ? await res.json() : `<unreadable: ${res.status} — needs the admin key>`;
}

console.log(`target      : ${HOST || "<MEILISEARCH_HOST unset>"}/indexes/jobs/settings/ranking-rules`);
console.log(`live now    : ${JSON.stringify(await liveRules())}`);
console.log(`expected    : ${JSON.stringify(CURRENT)}`);
console.log(`\n${label}\nproposed    : ${JSON.stringify(payload, null, 0)}`);
console.log(`rollback    : ${JSON.stringify(CURRENT)}`);

if (!apply) {
  console.log(
    "\nDRY RUN — nothing enqueued. Re-run with --apply to PUT.\n" +
      "Before applying: (1) confirm company_opened_90d coverage on live docs for Phase B,\n" +
      "(2) update JOBS_INDEX_SETTINGS.rankingRules in src/lib/jobs/meilisearch.ts in the\n" +
      "    SAME change — that export is the source of truth and must not drift,\n" +
      "(3) expect the document queue to stall ~24 min while the task runs.",
  );
  process.exit(0);
}
if (!ADMIN) {
  console.error("\n--apply needs MEILISEARCH_ADMIN_KEY / MEILI_ADMIN_KEY (not in .env.local; export it or run on the box).");
  process.exit(1);
}

const res = await fetch(`${HOST}/indexes/jobs/settings/ranking-rules`, {
  method: "PUT",
  headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}` },
  body: JSON.stringify(payload),
});
if (!res.ok) {
  console.error(`PUT failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { taskUid } = await res.json();
console.log(`enqueued task ${taskUid} — polling (queue stall expected)…`);
const startedAt = Date.now();
for (;;) {
  const t = await (await fetch(`${HOST}/tasks/${taskUid}`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
  if (t.status === "succeeded") break;
  if (t.status === "failed") {
    console.error("task failed:", JSON.stringify(t.error));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
console.log(`applied in ${((Date.now() - startedAt) / 60000).toFixed(1)} min:`, JSON.stringify(await liveRules()));
