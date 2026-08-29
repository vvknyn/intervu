#!/usr/bin/env node
/**
 * Push ONLY the synonyms setting to the live jobs index. Deliberately narrow:
 * a full settings PATCH would add "id" to filterableAttributes and trigger a
 * multi-hour reindex of ~1.8M docs — that re-provision belongs to the box's
 * sync worker, not this script.
 *
 *   node scripts/apply-synonyms.mjs             # apply JOBS_SYNONYMS
 *   node scripts/apply-synonyms.mjs --rollback  # clear all synonyms
 *
 * Env: MEILISEARCH_HOST + MEILISEARCH_ADMIN_KEY (or box names MEILI_URL /
 * MEILI_ADMIN_KEY). Reads .env.local; admin key is usually NOT there — export
 * it, or run this on the box.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Inline copy of the DERIVED JOBS_SYNONYMS (this is an .mjs script; it can't
// import the .ts module at CLI runtime — plain `node` has no TS loader).
// This is `deriveSynonyms(JOBS_SYNONYM_SOURCE)`'s output, not the source
// table — src/lib/jobs/meilisearch.ts is the source of truth. Parity is
// enforced by tests/unit/synonyms-parity.test.ts, which imports BOTH real
// sources (via tsx) and asserts deep equality; regenerate this block from
// the .ts source if that test fails
// (`npx tsx -e 'import {JOBS_SYNONYMS} from "./src/lib/jobs/meilisearch"; console.log(JSON.stringify(JOBS_SYNONYMS))'`).
export const JOBS_SYNONYMS = {
  swe: ["software engineer"],
  "software engineer": ["swe", "sde", "software developer"],
  sre: ["site reliability engineer"],
  "site reliability engineer": ["sre"],
  pm: ["product manager", "project manager"],
  k8s: ["kubernetes"],
  kubernetes: ["k8s"],
  ml: ["machine learning"],
  "machine learning": ["ml"],
  ux: ["user experience"],
  "user experience": ["ux"],
  qa: ["quality assurance"],
  "quality assurance": ["qa"],
  hr: ["human resources"],
  "human resources": ["hr"],
  devops: ["dev ops"],
  "dev ops": ["devops"],
  sde: ["software engineer", "software developer"],
  "software developer": ["sde", "software engineer"],
  "full stack": ["software engineer"],
};

// Everything below only runs when this file is executed directly (`node
// scripts/apply-synonyms.mjs`), never on `import` — so a test can import
// JOBS_SYNONYMS above without triggering env reads, network calls, or exit().
async function main() {
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

  const rollback = process.argv.includes("--rollback");
  const payload = rollback ? {} : JOBS_SYNONYMS;

  const res = await fetch(`${HOST}/indexes/jobs/settings/synonyms`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`PUT synonyms failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const { taskUid } = await res.json();
  for (;;) {
    const t = await (await fetch(`${HOST}/tasks/${taskUid}`, { headers: { authorization: `Bearer ${KEY}` } })).json();
    if (t.status === "succeeded") {
      console.log(rollback ? "Synonyms cleared." : "Synonyms applied.");
      break;
    }
    if (t.status === "failed") {
      console.error("Synonyms task failed:", t.error);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
