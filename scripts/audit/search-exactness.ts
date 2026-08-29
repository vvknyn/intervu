/**
 * INV-2 (exactness) audit for the jobs location facet.
 *
 * Why this exists: a whole class of composite location facet values —
 * "Boston-MA", "US-OH", "US-CA-Daly City", "United States-California-San
 * Diego" — advertise one count in the location picker's typeahead (a
 * Meilisearch facet-search hit with a `count`) and then deliver a DIFFERENT
 * set of results once a searcher actually selects the value. The failure is
 * bidirectional: several of these under-deliver (the picker overstates what
 * exists), and at least one over-delivered by roughly 4,800x (the resolved
 * filter silently widened from a 96-posting city to an entire country's
 * corpus — see `resolvePhraseOrRawLiteral`'s doc in query-understanding.ts
 * for the "US CA San Diego" case this script would have caught). Every one
 * of these was found so far by a human noticing a wrong number on screen.
 * This script exists to end that: it re-derives the advertised count and the
 * delivered count for the same values, through the same product code, and
 * fails loudly the moment they diverge — so it can become a CI gate instead
 * of a standing invitation for the next composite value to slip through.
 *
 * Method, for each of location_city / location_state / location_country:
 *   1. Pull the top K facet values Meilisearch's facet-search endpoint
 *      advertises (sorted by count — see `sortFacetValuesBy` in
 *      JOBS_INDEX_SETTINGS, meilisearch.ts) — the ADVERTISED number.
 *   2. Resolve each value through `resolveLocationFacet`
 *      (src/lib/jobs/query-understanding.ts) — the ONE function every real
 *      caller (the board's location box, a deep link, a saved search) routes
 *      a typed/selected location value through, regardless of which facet
 *      field it was drawn from (the UI has a single location input; see that
 *      function's doc for why every value goes in as `facets.location_country`).
 *   3. Run the resolved filter through `searchMeili` (the same search
 *      backend the SERP itself calls) and read back `total` — the DELIVERED
 *      number.
 *   4. Compare. OK / UNDER / OVER per value; nonzero exit on any violation.
 *
 * Read-only: only the Meilisearch `search` and `facet-search` endpoints are
 * touched (via `fetchFacetSearch` / `searchMeili`, both already read-path-only
 * in the product). No index writes, no settings changes.
 */
import { readFileSync } from "node:fs";
import { fetchFacetSearch, searchMeili, LOCATION_FACET_FIELDS } from "@/lib/jobs/meilisearch";
import { resolveLocationFacet } from "@/lib/jobs/query-understanding";
import { locationVocabulary } from "@/lib/jobs/search";
import type { JobSearchParams } from "@/lib/jobs/types";

// --- env loading (verbatim from /Users/vivek/.claude/jobs/cc81eafa/tmp/probe-html-entities.mjs) ---
const ENV = "/Users/vivek/Antigravity/Code/intervu/.env.local";
for (const line of readFileSync(ENV, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const HOST = process.env.MEILISEARCH_HOST;
const KEY = process.env.MEILISEARCH_SEARCH_KEY || process.env.MEILISEARCH_API_KEY || "";
if (!HOST) { console.error("MEILISEARCH_HOST not set — aborting"); process.exit(1); }
console.log("meili host:", new URL(HOST).host);
void KEY; // read by the product's own searchKey() at call time — never printed here.

type LocationField = (typeof LOCATION_FACET_FIELDS)[number];
type Verdict = "OK" | "UNDER" | "OVER";

interface Row {
  field: LocationField;
  value: string;
  advertised: number;
  delivered: number;
  verdict: Verdict;
}

const topArg = process.argv.find((a) => a.startsWith("--top="));
const TOP_K = topArg ? Number(topArg.slice("--top=".length)) : 40;
if (!Number.isFinite(TOP_K) || TOP_K <= 0) {
  console.error(`--top must be a positive integer, got ${topArg}`);
  process.exit(1);
}

function verdictFor(advertised: number, delivered: number): Verdict {
  if (delivered === advertised) return "OK";
  return delivered < advertised ? "UNDER" : "OVER";
}

async function advertisedValues(field: LocationField): Promise<{ value: string; count: number }[]> {
  const hits = await fetchFacetSearch(field, "");
  if (hits === null) throw new Error(`facet-search for ${field} failed — check Meili connectivity/credentials`);
  return hits.slice(0, TOP_K);
}

async function deliveredCount(
  value: string,
  vocab: Awaited<ReturnType<typeof locationVocabulary>>,
): Promise<number> {
  // Every real caller (board location box, deep link, saved search) hands a
  // typed/selected location value in as `facets.location_country` regardless
  // of whether it names a city, state, or country — see resolveLocationFacet's
  // doc. Reproducing that shape here is what makes this the SAME code path,
  // not a parallel one.
  const params: JobSearchParams = { facets: { location_country: [value] }, limit: 0 };
  const resolved = await resolveLocationFacet(params, vocab);
  const result = await searchMeili(resolved);
  return result.total;
}

async function main() {
  const vocab = await locationVocabulary();
  const rows: Row[] = [];

  for (const field of LOCATION_FACET_FIELDS) {
    const advertised = await advertisedValues(field);
    console.log(`\n=== ${field} — top ${advertised.length} advertised value(s) ===`);
    for (const { value, count } of advertised) {
      const delivered = await deliveredCount(value, vocab);
      const verdict = verdictFor(count, delivered);
      rows.push({ field, value, advertised: count, delivered, verdict });
      console.log(
        `${verdict.padEnd(5)} ${field.padEnd(16)} ${JSON.stringify(value).padEnd(42)} advertised=${count} delivered=${delivered}`,
      );
    }
  }

  const violations = rows.filter((r) => r.verdict !== "OK");
  console.log(`\n${rows.length} value(s) checked across ${LOCATION_FACET_FIELDS.length} field(s), ${violations.length} violation(s).`);
  if (violations.length > 0) {
    console.log("\nViolations:");
    for (const v of violations) {
      console.log(`  ${v.verdict}  ${v.field}=${JSON.stringify(v.value)}  advertised=${v.advertised} delivered=${v.delivered}`);
    }
  }
  process.exit(violations.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
