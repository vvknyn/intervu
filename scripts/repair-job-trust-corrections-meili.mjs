#!/usr/bin/env node
/**
 * One-shot Meili repair: apply the same read-path trust corrections as
 * `applyTrustCorrections` (src/lib/jobs/trust-corrections.ts) to live documents.
 *
 * Read-path corrections ship with the intervu app deploy (`normalizePublicJob`).
 * This script backfills documents already in Meili. Upstream jobs-sync
 * (/opt/jobs-sync/sync.mjs on Contabo) may reintroduce bad domains until fixed
 * there — treat this as a live repair, not a permanent ingest fix.
 *
 * SAFE BY DEFAULT — dry run unless --apply is passed.
 *
 * Hop (Contabo — NOT run from CI / cloud agents):
 *
 *   CREDS=$(ssh subspace@194.163.147.154 'set -a; . /opt/jobs-sync/.env; set +a;
 *            printf "%s|%s" "$MEILI_URL" "$MEILI_MASTER_KEY"')
 *   npx tsx scripts/repair-job-trust-corrections-meili.mjs \
 *        --host="${CREDS%%|*}" --key="${CREDS##*|}" --expect-host=meili-box
 *   npx tsx scripts/repair-job-trust-corrections-meili.mjs \
 *        --host="${CREDS%%|*}" --key="${CREDS##*|}" --expect-host=meili-box --apply
 *
 * Target: --host=… --key=… beat env vars, which beat .env.local.
 * --expect-host=<substring> refuses to run against the wrong box.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const exported = { ...process.env };
const fromFile = {};
try {
  for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m) fromFile[m[1]] = m[2];
  }
} catch {}
const pick = (...names) => {
  for (const n of names) if (exported[n]) return exported[n];
  for (const n of names) if (fromFile[n]) return fromFile[n];
  return "";
};

const HOST = (arg("host") ?? pick("MEILISEARCH_HOST", "MEILI_URL")).replace(/\/+$/, "");
const KEY = arg("key") ?? pick("MEILISEARCH_ADMIN_KEY", "MEILI_ADMIN_KEY", "MEILI_MASTER_KEY");
if (!HOST || !KEY) {
  console.error(
    "Missing host or admin key.\n" +
      "  --host=https://… --key=… , or export MEILISEARCH_HOST/MEILI_URL +\n" +
      "  MEILISEARCH_ADMIN_KEY/MEILI_ADMIN_KEY/MEILI_MASTER_KEY.",
  );
  process.exit(1);
}
if (arg("expect-host") && !HOST.includes(arg("expect-host"))) {
  console.error(`REFUSING: resolved host ${HOST} does not match --expect-host=${arg("expect-host")}.`);
  process.exit(5);
}

const INDEX = "jobs";
const apply = process.argv.includes("--apply");
const HITS_PER_PAGE = 200;

const { applyTrustCorrections, jobNeedsTrustCorrection, listCanadaForeignDomainRisks } =
  await import("../src/lib/jobs/trust-corrections.ts");

const call = async (path, init = {}) => {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${String(text).slice(0, 200)}`);
  return body;
};

/** Collect hits from a Meili search, paging until exhausted. */
async function searchAll(body) {
  const byId = new Map();
  for (let page = 1; ; page++) {
    const res = await call(`/indexes/${INDEX}/search`, {
      method: "POST",
      body: JSON.stringify({ ...body, hitsPerPage: HITS_PER_PAGE, page }),
    });
    for (const hit of res.hits ?? []) {
      if (hit.id) byId.set(hit.id, hit);
    }
    const totalPages = res.totalPages ?? 1;
    if (page >= totalPages || (res.hits?.length ?? 0) === 0) break;
  }
  return [...byId.values()];
}

function patchFields(before, after) {
  const patch = { id: before.id };
  if (after.company_domain !== before.company_domain) patch.company_domain = after.company_domain;
  if (after.salary_currency !== before.salary_currency) patch.salary_currency = after.salary_currency;
  return patch;
}

async function main() {
  console.log(`host    ${HOST}`);
  console.log(`index   ${INDEX}`);
  console.log(`mode    ${apply ? "APPLY" : "dry run — pass --apply to write"}`);

  const stats = await call(`/indexes/${INDEX}/stats`);
  console.log(`docs    ${stats.numberOfDocuments?.toLocaleString?.() ?? stats.numberOfDocuments}`);

  const risks = listCanadaForeignDomainRisks();
  const wrongDomains = [...new Set(risks.flatMap((r) => r.wrongDomains))];
  console.log(`watch   wrong domains: ${wrongDomains.join(", ") || "(none)"}`);

  const queries = [
    {
      label: "known wrong domains",
      body: wrongDomains.length
        ? { q: "", filter: [`company_domain IN [${wrongDomains.map((d) => JSON.stringify(d)).join(", ")}]`] }
        : null,
    },
    {
      label: "Toronto-Dominion company text",
      body: { q: "Toronto-Dominion", attributesToSearchOn: ["company"] },
    },
    {
      label: "TD Bank (Canada) company text",
      body: { q: "TD Bank Canada", attributesToSearchOn: ["company"] },
    },
    {
      label: "CAD in description with stored USD salary",
      body: {
        q: "CAD",
        filter: ['salary_currency = "USD"'],
        attributesToSearchOn: ["description"],
      },
    },
  ];

  const byId = new Map();
  for (const q of queries) {
    if (!q.body) continue;
    const hits = await searchAll(q.body);
    console.log(`query   ${q.label}: ${hits.length} hit(s)`);
    for (const hit of hits) byId.set(hit.id, hit);
  }

  const candidates = [...byId.values()];
  const patches = [];
  let domainFixes = 0;
  let currencyFixes = 0;

  for (const hit of candidates) {
    if (!jobNeedsTrustCorrection(hit)) continue;
    const corrected = applyTrustCorrections(hit);
    const patch = patchFields(hit, corrected);
    if (Object.keys(patch).length <= 1) continue;
    if (patch.company_domain) domainFixes++;
    if (patch.salary_currency) currencyFixes++;
    patches.push({ before: hit, patch, corrected });
  }

  console.log(`\ncandidates scanned ${candidates.length}`);
  console.log(`would patch ${patches.length} document(s) (${domainFixes} domain, ${currencyFixes} currency)`);

  const sample = patches.slice(0, 8);
  for (const { before, patch } of sample) {
    console.log(
      `  ${before.id}  ${before.company ?? "?"}  domain ${before.company_domain ?? "∅"} → ${patch.company_domain ?? before.company_domain ?? "∅"}  currency ${before.salary_currency ?? "∅"} → ${patch.salary_currency ?? before.salary_currency ?? "∅"}`,
    );
  }
  if (patches.length > sample.length) {
    console.log(`  … and ${patches.length - sample.length} more`);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with --apply to POST patches.");
    return;
  }

  if (patches.length === 0) {
    console.log("\nNothing to apply.");
    return;
  }

  const BATCH = 100;
  for (let i = 0; i < patches.length; i += BATCH) {
    const batch = patches.slice(i, i + BATCH).map((p) => p.patch);
    const task = await call(`/indexes/${INDEX}/documents`, {
      method: "POST",
      body: JSON.stringify(batch),
    });
    console.log(`posted batch ${Math.floor(i / BATCH) + 1} (${batch.length} docs) task ${task.taskUid ?? task.uid ?? "?"}`);
  }

  console.log(`\nApplied ${patches.length} patch(es). Monitor Meili tasks for indexing completion.`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
