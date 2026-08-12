#!/usr/bin/env node
/**
 * Read-only simulation of a proposed rankingRules plateau ordering.
 *
 * apply-ranking-rules-v2.mjs proposes ordering the relevance plateau by
 * `company_opened_90d:desc` (PHASE_B) and says, in its own docblock, that the
 * tiebreaker is UNVALIDATED and must be measured on the live pool before it is
 * applied. No tool existed to do that. This is it.
 *
 * It never writes and never touches index settings. Two deliberate choices:
 *
 *  - Aggregates are joined from `public_company_stats`, NOT read off the
 *    documents, so the result does not depend on how far the index backfill
 *    has progressed. (`company_opened_90d` is also absent from
 *    sortableAttributes, so Meilisearch could not sort on it live anyway
 *    without a further queue-blocking settings write.)
 *  - It reports DISTINCT EMPLOYERS IN TOP-10. The proposal's stated goal is
 *    surfacing employers who are genuinely hiring; the failure mode it was
 *    warned about (agencies) and the one actually found (mega-employers
 *    swallowing the page) both show up as collapsing employer diversity.
 *
 * Usage (on the box, where both endpoints are reachable):
 *   node scripts/simulate-ranking-tiebreaker.mjs --pool=400
 *
 * Env: MEILISEARCH_HOST/MEILI_URL + MEILISEARCH_ADMIN_KEY/MEILI_ADMIN_KEY,
 * and DATABASE_URL. Falls back to the box's /opt/jobs-sync/.env and
 * /opt/interview-os/.env so it runs there with no exports.
 */
import fs from "node:fs";
import { Client } from "pg";

const POOL = Number(process.argv.find((a) => a.startsWith("--pool="))?.split("=")[1] ?? 400);
const QUERIES = (process.argv.find((a) => a.startsWith("--queries="))?.split("=")[1] ?? "")
  .split(",").filter(Boolean);

const DEFAULT_QUERIES = [
  "product manager",
  "software engineer",
  "registered nurse",
  "data analyst",
  "accountant",
  "marketing manager",
];

function readEnvFiles(paths) {
  let out = "";
  for (const p of paths) { try { out += fs.readFileSync(p, "utf8") + "\n"; } catch { /* optional */ } }
  return out;
}
const envVal = (blob, key) => {
  const m = blob.match(new RegExp(`^${key}=(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const boxSync = readEnvFiles(["/opt/jobs-sync/.env"]);
const boxApp = readEnvFiles(["/opt/interview-os/.env", "/opt/interview-os/.env.local"]);

const HOST = (process.env.MEILISEARCH_HOST || process.env.MEILI_URL || envVal(boxSync, "MEILI_URL") || "").replace(/\/+$/, "");
const KEY = process.env.MEILISEARCH_ADMIN_KEY || process.env.MEILI_ADMIN_KEY || envVal(boxSync, "MEILI_ADMIN_KEY") || "";
const DB_URL = (process.env.DATABASE_URL || envVal(boxApp, "DATABASE_URL") || envVal(boxApp, "SUPABASE_DB_URL") || "")
  .replace(":6543/", ":5432/");

if (!HOST || !KEY) { console.error("need MEILISEARCH_HOST + MEILISEARCH_ADMIN_KEY"); process.exit(1); }
if (!DB_URL) { console.error("need DATABASE_URL"); process.exit(1); }

async function search(q, limit) {
  const res = await fetch(`${HOST}/indexes/jobs/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ q, limit, attributesToRetrieve: ["id", "title", "company", "company_domain", "posted_ts"] }),
  });
  if (!res.ok) throw new Error(`search ${res.status} ${await res.text()}`);
  return (await res.json()).hits ?? [];
}

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("SET statement_timeout = 60000");
const { rows } = await client.query(
  `SELECT company_domain, openings_90d, closures_90d, live_postings FROM public_company_stats`);
await client.end();
const stats = new Map(rows.map((r) => [r.company_domain, r]));
console.log(`loaded ${stats.size} company stat rows; pool=${POOL} per query\n`);

const fmt = (h) => {
  const s = stats.get(h.company_domain);
  const op = s?.openings_90d ?? null, cl = s?.closures_90d ?? null, live = s?.live_postings ?? null;
  return `${String(h.company ?? "?").slice(0, 28).padEnd(28)} op90=${String(op ?? "—").padStart(6)} cl90=${String(cl ?? "—").padStart(6)} live=${String(live ?? "—").padStart(6)}  ${String(h.title ?? "").slice(0, 44)}`;
};

let curTotal = 0, bTotal = 0, n = 0;
for (const q of (QUERIES.length ? QUERIES : DEFAULT_QUERIES)) {
  const hits = await search(q, POOL);
  console.log("=".repeat(118));
  console.log(`QUERY "${q}"  (pool ${hits.length})`);
  console.log("-- CURRENT top 10 " + "-".repeat(96));
  for (const h of hits.slice(0, 10)) console.log("   " + fmt(h));

  // PHASE B plateau ordering; missing aggregate sorts last, as Meilisearch does.
  const sorted = [...hits].sort((a, b) => {
    const ao = stats.get(a.company_domain)?.openings_90d ?? -1;
    const bo = stats.get(b.company_domain)?.openings_90d ?? -1;
    return bo !== ao ? bo - ao : (b.posted_ts ?? 0) - (a.posted_ts ?? 0);
  });
  console.log("-- PHASE B top 10 (company_opened_90d desc) " + "-".repeat(71));
  for (const h of sorted.slice(0, 10)) console.log("   " + fmt(h));

  const cur = new Set(hits.slice(0, 10).map((h) => h.company_domain)).size;
  const b = new Set(sorted.slice(0, 10).map((h) => h.company_domain)).size;
  curTotal += cur; bTotal += b; n++;
  console.log(`   >> distinct employers in top-10:  current=${cur}  phaseB=${b}`);
  console.log();
}
console.log("=".repeat(118));
console.log(`MEAN distinct employers in top-10 over ${n} queries: current=${(curTotal / n).toFixed(1)}  phaseB=${(bTotal / n).toFixed(1)}`);
