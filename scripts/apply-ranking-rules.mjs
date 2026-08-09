#!/usr/bin/env node
/**
 * Push ONLY the ranking-rules setting to the live jobs index. Deliberately
 * narrow: a full settings PATCH would add "id" to filterableAttributes and
 * trigger a multi-hour reindex of ~1.8M docs — that re-provision belongs to
 * the box's sync worker, not this script.
 *
 *   node scripts/apply-ranking-rules.mjs             # apply the 8-rule set
 *   node scripts/apply-ranking-rules.mjs --rollback  # restore the 7-rule default
 *
 * Env: MEILISEARCH_HOST + MEILISEARCH_ADMIN_KEY (or box names MEILI_URL /
 * MEILI_ADMIN_KEY). Reads .env.local; admin key is usually NOT there — export
 * it, or run this on the box.
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

const HOST = (process.env.MEILISEARCH_HOST ?? process.env.MEILI_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.MEILISEARCH_ADMIN_KEY ?? process.env.MEILI_ADMIN_KEY ?? "";
if (!HOST || !KEY) {
  console.error("Missing MEILISEARCH_HOST/MEILI_URL or MEILISEARCH_ADMIN_KEY/MEILI_ADMIN_KEY.");
  process.exit(1);
}

// Inline copy of JOBS_INDEX_SETTINGS.rankingRules (this is an .mjs script; it
// can't import the .ts module). MUST match src/lib/jobs/meilisearch.ts — that
// export is the source of truth; update both together. "posted_ts:desc" is
// the FINAL rule: recency is the tiebreak among equally-relevant hits, never
// a substitute for relevance.
// Meili 1.45's canonical rule names — a live GET returns attributeRank /
// wordPosition, not the legacy attribute/position forms.
// S3 (search-audit.md class 3): `sort` moved AFTER `wordPosition`/
// `exactness` — an explicit user sort (e.g. "freshest") must only break ties
// among already-relevant matches, never outrank the company-match precision
// those two rules provide. See JOBS_INDEX_SETTINGS's doc comment.
const RANKING_RULES = ["words", "typo", "proximity", "attributeRank", "wordPosition", "exactness", "sort", "posted_ts:desc"];
// Meilisearch's built-in default (what --rollback restores).
const DEFAULT_RANKING_RULES = ["words", "typo", "proximity", "attributeRank", "sort", "wordPosition", "exactness"];

const rollback = process.argv.includes("--rollback");
const payload = rollback ? DEFAULT_RANKING_RULES : RANKING_RULES;

const res = await fetch(`${HOST}/indexes/jobs/settings/ranking-rules`, {
  method: "PUT",
  headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
  body: JSON.stringify(payload),
});
if (!res.ok) {
  console.error(`PUT ranking-rules failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { taskUid } = await res.json();
for (;;) {
  const t = await (await fetch(`${HOST}/tasks/${taskUid}`, { headers: { authorization: `Bearer ${KEY}` } })).json();
  if (t.status === "succeeded") break;
  if (t.status === "failed") {
    console.error("task failed:", JSON.stringify(t.error));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}
const current = await (
  await fetch(`${HOST}/indexes/jobs/settings/ranking-rules`, { headers: { authorization: `Bearer ${KEY}` } })
).json();
console.log(rollback ? "ranking rules restored to default:" : "ranking rules applied:", JSON.stringify(current, null, 2));
