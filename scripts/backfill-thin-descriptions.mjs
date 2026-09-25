/**
 * Backfill thin/missing job descriptions via Subspace POST /jobs/fill-descriptions.
 *
 * Scope: Meili jobs whose description is empty, < TEASER_MAX_LEN (220), or
 * ends with "..." / "…". Does NOT Contabo-ship Meili/PG — Subspace persists
 * the fill server-side; Meili picks it up on the next sync/changed poll.
 *
 * Usage (from intervu root, with SUBSPACE_API_KEY + MEILISEARCH_* in env):
 *   node --env-file=.env.local scripts/backfill-thin-descriptions.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-thin-descriptions.mjs --limit=100
 *   node --env-file=.env.local scripts/backfill-thin-descriptions.mjs --limit=500 --offset=0
 *
 * Batch size matches the Subspace fill-descriptions API cap (20 ids).
 */
const TEASER_MAX_LEN = 220; // keep in sync with src/lib/jobs/fill-description.ts

const MEILI_HOST = (process.env.MEILISEARCH_HOST || "").replace(/\/+$/, "");
const MEILI_KEY = process.env.MEILISEARCH_SEARCH_KEY || process.env.MEILISEARCH_ADMIN_KEY || "";
const SUBSPACE_KEY = process.env.SUBSPACE_API_KEY || "";
const SUBSPACE_BASE = (process.env.SUBSPACE_API_BASE_URL || "https://www.thesubspace.io/api/v1").replace(/\/+$/, "");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const dryRun = args["dry-run"] === "true";
const limit = Math.max(1, Number(args.limit || 100));
const sampleOffset = Math.max(0, Number(args.offset || 0));
const sampleCap = Math.max(limit, Number(args["sample-cap"] || 5000));

function needsFill(desc) {
  if (desc == null || String(desc).trim() === "") return true;
  const trimmed = String(desc).trimEnd();
  if (trimmed.length < TEASER_MAX_LEN) return true;
  return trimmed.endsWith("...") || trimmed.endsWith("…");
}

async function meiliSearch(body) {
  const res = await fetch(`${MEILI_HOST}/indexes/jobs/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MEILI_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Meili ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fillBatch(ids) {
  const res = await fetch(`${SUBSPACE_BASE}/jobs/fill-descriptions`, {
    method: "POST",
    headers: {
      "x-api-key": SUBSPACE_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ ids, mode: "visible" }),
  });
  if (!res.ok) throw new Error(`fill-descriptions ${res.status}: ${await res.text()}`);
  const env = await res.json();
  return env.data ?? [];
}

async function main() {
  if (!MEILI_HOST || !MEILI_KEY) {
    console.error("MEILISEARCH_HOST + MEILISEARCH_SEARCH_KEY required");
    process.exit(1);
  }
  if (!dryRun && !SUBSPACE_KEY) {
    console.error("SUBSPACE_API_KEY required unless --dry-run");
    process.exit(1);
  }

  const thin = [];
  let scanned = 0;
  for (let offset = sampleOffset; scanned < sampleCap && thin.length < limit; offset += 100) {
    const page = await meiliSearch({
      q: "",
      limit: 100,
      offset,
      attributesToRetrieve: ["id", "title", "company", "description", "source"],
    });
    const hits = page.hits || [];
    if (!hits.length) break;
    for (const h of hits) {
      scanned += 1;
      if (!needsFill(h.description)) continue;
      thin.push({
        id: h.id,
        title: h.title,
        company: h.company,
        source: h.source,
        descLen: (h.description || "").length,
      });
      if (thin.length >= limit) break;
    }
    if (hits.length < 100) break;
  }

  console.log(JSON.stringify({ scanned, thinCandidates: thin.length, dryRun, teaserMax: TEASER_MAX_LEN }, null, 2));
  for (const t of thin.slice(0, 15)) {
    console.log(`  - ${t.descLen}\t${t.source}\t${t.company}\t${t.title}\t${t.id}`);
  }
  if (thin.length > 15) console.log(`  … +${thin.length - 15} more`);

  if (dryRun) {
    console.log("Dry run only — no fill-descriptions calls.");
    return;
  }

  let filled = 0;
  let stillThin = 0;
  for (let i = 0; i < thin.length; i += 20) {
    const chunk = thin.slice(i, i + 20);
    const ids = chunk.map((c) => c.id);
    const results = await fillBatch(ids);
    for (const r of results) {
      const len = (r.description || "").length;
      if (r.description && !needsFill(r.description)) filled += 1;
      else stillThin += 1;
      console.log(`fill ${r.id} → ${len} chars`);
    }
  }
  console.log(JSON.stringify({ filled, stillThin, requested: thin.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
