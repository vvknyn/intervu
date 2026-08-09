#!/usr/bin/env node
/**
 * AUDIT CONTROL ARM — bare Meili query (q + vacancy_status filter only, no
 * matchingStrategy override, no facets, no sort). Mirrors golden-queries.mjs's
 * shape. Read-only against the live index. Never prints env values.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  try {
    const text = readFileSync(join(here, "..", ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnvLocal();

const HOST = (process.env.MEILISEARCH_HOST ?? "").replace(/\/+$/, "");
const KEY = process.env.MEILISEARCH_SEARCH_KEY ?? process.env.MEILISEARCH_API_KEY ?? "";
if (!HOST || !KEY) {
  console.error("Missing MEILISEARCH_HOST / MEILISEARCH_SEARCH_KEY");
  process.exit(1);
}

const QUERIES = [
  "stripe", "walmart", "cleveland clinic", "home depot",
  "nurse", "registered nurse", "rn", "software engineer", "swe", "accountant", "acountant",
  "remote customer service jobs", "part time evening jobs", "warehouse jobs in dallas", "entry level marketing jobs", "jobs near me",
  "stripe software engineer", "nurse at cleveland clinic",
  "jobs paying $25 an hour",
];

async function search(q, extra = {}) {
  const body = { q, filter: ['vacancy_status != "closed"'], hitsPerPage: 5, page: 1, ...extra };
  const res = await fetch(`${HOST}/indexes/jobs/search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
  const json = await res.json();
  return {
    total: json.totalHits ?? json.estimatedTotalHits ?? json.hits?.length ?? 0,
    top5: (json.hits ?? []).map((h) => `${h.title} | ${h.company} | ${h.location_city ?? ""},${h.location_country ?? ""}`),
  };
}

const out = [];
for (const q of QUERIES) {
  const bare = await search(q);
  out.push({ q, arm: "control-bare", ...bare });
  console.log(`[bare] ${q} -> total=${bare.total ?? "ERR"}`);
}

// Sticky-sort magnitude probe: same query, explicit posted_ts:desc sort vs none.
for (const q of ["stripe", "walmart"]) {
  const relevance = await search(q);
  const newest = await search(q, { sort: ["posted_ts:desc"] });
  out.push({ q, arm: "control-sort-compare", relevance, newest });
  console.log(`[sort-compare] ${q} relevance-top1="${relevance.top5?.[0]}" newest-top1="${newest.top5?.[0]}"`);
}

writeFileSync(join(here, "..", "audit-control-results.json"), JSON.stringify(out, null, 2));
console.log("wrote scripts/../audit-control-results.json");
