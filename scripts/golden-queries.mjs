#!/usr/bin/env node
/**
 * Golden-query relevance harness (S1, spec §6.8). Measures precision@5 for a
 * fixed query set against the LIVE Meilisearch index, replicating the app's
 * read path (same filter baseline as buildFilter's invariant clause).
 *
 *   node scripts/golden-queries.mjs                 # default engine behavior
 *   node scripts/golden-queries.mjs --titles-only   # precision pass (attributesToSearchOn)
 *   node scripts/golden-queries.mjs --save          # also write scripts/golden-baseline.json
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
  } catch {
    /* no .env.local — rely on ambient env */
  }
}
loadEnvLocal();

const HOST = (process.env.MEILISEARCH_HOST ?? process.env.MEILI_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.MEILISEARCH_SEARCH_KEY ?? process.env.MEILISEARCH_API_KEY ?? process.env.MEILI_KEY ?? "";
if (!HOST || !KEY) {
  console.error("Missing MEILISEARCH_HOST / MEILISEARCH_SEARCH_KEY (or MEILI_URL / MEILI_KEY).");
  process.exit(1);
}

const titlesOnly = process.argv.includes("--titles-only");
const save = process.argv.includes("--save");
const { queries } = JSON.parse(readFileSync(join(here, "golden-queries.json"), "utf8"));

async function searchTop5(q) {
  const body = {
    q,
    filter: ['vacancy_status != "closed"'],
    hitsPerPage: 5,
    page: 1,
    ...(titlesOnly ? { attributesToSearchOn: ["title", "company"] } : {}),
  };
  const res = await fetch(`${HOST}/indexes/jobs/search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`search "${q}" failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.hits ?? []).map((h) => ({ title: h.title ?? "", company: h.company ?? "" }));
}

const perQuery = [];
for (const spec of queries) {
  const hits = await searchTop5(spec.q);
  const re = new RegExp(spec.expectCompany ?? spec.expect, "i");
  const field = spec.expectCompany ? "company" : "title";
  const matched = hits.filter((h) => re.test(h[field])).length;
  const precisionAt5 = hits.length ? matched / 5 : 0;
  perQuery.push({ q: spec.q, precisionAt5, top5: hits.map((h) => `${h.title} | ${h.company}`) });
  console.log(`${precisionAt5.toFixed(1).padStart(4)}  ${spec.q}`);
}
const mean = perQuery.reduce((a, r) => a + r.precisionAt5, 0) / perQuery.length;
console.log(`\nmode: ${titlesOnly ? "titles-only" : "default"}  mean precision@5: ${mean.toFixed(3)}`);

if (save) {
  writeFileSync(
    join(here, "golden-baseline.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), mode: titlesOnly ? "titles-only" : "default", mean, perQuery },
      null,
      2,
    ) + "\n",
  );
  console.log("wrote scripts/golden-baseline.json");
}
