#!/usr/bin/env node
/**
 * Detects drift between the repo-canonical `JOBS_INDEX_SETTINGS`
 * (src/lib/jobs/meilisearch.ts) and the live jobs index's actual settings.
 *
 * Why this exists: `applyIndexSettings()` PATCHes the whole settings object,
 * and Meilisearch REPLACES array-valued settings (filterableAttributes etc.)
 * wholesale rather than merging entries — so a canon that's missing an
 * attribute the live index already carries (e.g. `occupation`, added
 * box-side via Meili task 467532, 2026-08-18) would silently DROP it on the
 * next apply. This script catches that class of drift before it ships,
 * instead of relying on someone noticing a live GET disagrees with the repo.
 *
 * READ-ONLY — only ever GETs, never PUTs/PATCHes anything.
 *
 *   node scripts/check-index-settings-drift.mjs
 *
 * Env: MEILISEARCH_HOST + MEILISEARCH_ADMIN_KEY (or box names MEILI_URL /
 * MEILI_ADMIN_KEY). Reading /settings needs the admin key, same as every
 * other admin script here. Reads .env.local; admin key is usually NOT
 * there — export it, or run this on the box.
 *
 * Inline copy of JOBS_INDEX_SETTINGS below: this is a plain .mjs CLI script
 * with no TypeScript loader, so (like apply-synonyms.mjs's JOBS_SYNONYMS) it
 * can't import the .ts canon at runtime. tests/unit/index-settings-drift.test.ts
 * imports BOTH real sources and asserts deep equality, so this copy drifting
 * from src/lib/jobs/meilisearch.ts fails a test instead of silently
 * comparing the live index against a stale expectation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JOBS_SYNONYMS } from "./apply-synonyms.mjs";

// Inline copy — see header. MUST match src/lib/jobs/meilisearch.ts's
// JOBS_INDEX_SETTINGS export; update both together (synonyms-parity-style
// test enforces it — see tests/unit/index-settings-drift.test.ts).
export const JOBS_INDEX_SETTINGS = {
  searchableAttributes: ["title", "company", "description", "location", "tags"],
  filterableAttributes: [
    "work_type",
    "employment_type",
    "experience_level",
    "location_city",
    "location_state",
    "location_country",
    "salary_min",
    "salary_max",
    "visa_sponsorship",
    "ghost_badge",
    "source",
    "vacancy_status",
    "company_domain",
    "posted_ts",
    "id",
    "title",
    "occupation",
  ],
  sortableAttributes: ["posted_at", "first_seen_at", "updated_at", "salary_min", "salary_max", "posted_ts"],
  rankingRules: ["words", "typo", "sort", "proximity", "attributeRank", "wordPosition", "exactness", "posted_ts:desc"],
  synonyms: JOBS_SYNONYMS,
  typoTolerance: { minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 } },
  pagination: { maxTotalHits: 100000 },
  faceting: { maxValuesPerFacet: 300, sortFacetValuesBy: { "*": "count" } },
  searchCutoffMs: 5000,
};

/**
 * Pure diff: for every key in `canonical`, compares against `live[key]`.
 *
 * Array-valued settings are compared as SETS, not sequences — Meilisearch's
 * own GET resorts some array settings regardless of declared order
 * (filterableAttributes comes back alphabetically; live-verified 2026-08-24
 * against src/lib/jobs/meilisearch.ts's declaration order, which is
 * grouped by when each attribute was added, not alphabetical), so a
 * positional diff would falsely flag settings that have never actually
 * drifted. Non-array values (objects, numbers) are compared by deep
 * equality instead.
 *
 * Only keys present in `canonical` are checked — a live setting this repo
 * declares no opinion on is out of scope, not a difference. This also means
 * a newly-added canonical setting key is covered automatically, with no
 * change needed here.
 *
 * Returns one entry per DIFFERING key only; an empty array means no drift.
 */
export function diffIndexSettings(canonical, live) {
  const diffs = [];
  for (const key of Object.keys(canonical)) {
    const canonValue = canonical[key];
    const liveValue = live?.[key];
    if (Array.isArray(canonValue)) {
      const liveArr = Array.isArray(liveValue) ? liveValue : [];
      const liveSet = new Set(liveArr.map((v) => JSON.stringify(v)));
      const canonSet = new Set(canonValue.map((v) => JSON.stringify(v)));
      const canonOnly = canonValue.filter((v) => !liveSet.has(JSON.stringify(v)));
      const liveOnly = liveArr.filter((v) => !canonSet.has(JSON.stringify(v)));
      if (canonOnly.length || liveOnly.length) diffs.push({ key, canonOnly, liveOnly });
    } else if (JSON.stringify(canonValue) !== JSON.stringify(liveValue)) {
      diffs.push({ key, canonOnly: [canonValue], liveOnly: [liveValue] });
    }
  }
  return diffs;
}

function fmt(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function formatDiffReport(diffs) {
  if (diffs.length === 0) return "No drift — canon matches the live jobs index.";
  const lines = [`Index settings drift — ${diffs.length} key(s) differ from the live jobs index:`];
  for (const { key, canonOnly, liveOnly } of diffs) {
    lines.push(`  ${key}:`);
    if (canonOnly.length) lines.push(`    canon-only: ${canonOnly.map(fmt).join(", ")}`);
    if (liveOnly.length) lines.push(`    live-only:  ${liveOnly.map(fmt).join(", ")}`);
  }
  return lines.join("\n");
}

// Everything below only runs when this file is executed directly (`node
// scripts/check-index-settings-drift.mjs`), never on `import` — so a test
// can import JOBS_INDEX_SETTINGS/diffIndexSettings above without triggering
// env reads, network calls, or exit().
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

  const res = await fetch(`${HOST}/indexes/jobs/settings`, { headers: { authorization: `Bearer ${KEY}` } });
  if (!res.ok) {
    console.error(`GET settings failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const live = await res.json();
  const diffs = diffIndexSettings(JOBS_INDEX_SETTINGS, live);
  console.log(formatDiffReport(diffs));
  if (diffs.length > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
