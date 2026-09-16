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
 * fails loudly the moment they diverge in a way that's actually a bug.
 *
 * A first version of this checker compared every value with strict equality
 * and reported 87/120 "violations" — mostly false positives. Two things it
 * conflated with a real exactness failure:
 *
 *   - A SINGLE named place ("New York", "CA") is a human phrase, and the
 *     resolver deliberately WIDENS it — radius neighbors, alias spellings,
 *     admin1/country scoping (see parsePlaceTokens's doc, and the "Toronto"
 *     radius-neighbor regression test, jobs-place-parsing.test.ts). Selecting
 *     it delivering MORE than the picker's narrow single-field count is the
 *     intended behavior, not a bug. Only under-delivery (the corpus
 *     advertises rows the search can't return) is a real failure here.
 *   - A value whose advertised count is at/over Meilisearch's own
 *     `pagination.maxTotalHits` cap can never be verified by comparing
 *     against a `search` total — that total is capped, so the comparison is
 *     structurally unsatisfiable regardless of correctness.
 *
 * The corrected invariant splits by ARITY — how many distinct places the raw
 * value decomposes into, per the SAME gazetteer scanner the product's own
 * resolver runs internally (`scanPlacePhrases`, lib/geo/resolve-place.ts; not
 * a hardcoded list of "known composite" values, so a new composite value in
 * the corpus is covered by construction, not by enumeration):
 *
 *   - advertised >= the index's maxTotalHits cap: SKIPPED, not compared —
 *     the measurement is meaningless, not evidence of anything.
 *   - arity <= 1 (a single place, or a raw literal the gazetteer doesn't even
 *     recognize as a place name): delivered >= advertised is required;
 *     widening is allowed and expected. Violation only on UNDER-delivery.
 *   - arity >= 2 (a machine-emitted composite the gazetteer decomposed into
 *     multiple place phrases — "Boston-MA" -> Boston + MA): delivered must
 *     equal advertised EXACTLY. This is the class that motivated the whole
 *     exercise — a searcher picked one literal corpus value and expects
 *     exactly that set, not a union or a widened subset.
 *
 * Method, for each of location_city / location_state / location_country:
 *   1. Pull the top K facet values Meilisearch's facet-search endpoint
 *      advertises (sorted by count — see `sortFacetValuesBy` in
 *      JOBS_INDEX_SETTINGS, meilisearch.ts) — the ADVERTISED number.
 *   2. Decompose the raw value with `scanPlacePhrases` (lib/geo/resolve-place.ts)
 *      to get its arity and the names it decomposed into.
 *   3. Resolve the value through `resolveLocationFacet`
 *      (src/lib/jobs/query-understanding.ts) — the ONE function every real
 *      caller (the board's location box, a deep link, a saved search) routes
 *      a typed/selected location value through, regardless of which facet
 *      field it was drawn from (the UI has a single location input; see that
 *      function's doc for why every value goes in as `facets.location_country`).
 *   4. Run the resolved filter through `searchMeili` (the same search
 *      backend the SERP itself calls) and read back `total` — the DELIVERED
 *      number.
 *   5. Classify per the arity rule above. Nonzero exit on any real violation;
 *      skipped-at-cap values never affect the exit code.
 *
 * Read-only: only the Meilisearch `search` and `facet-search` endpoints are
 * touched (via `fetchFacetSearch` / `searchMeili`, both already read-path-only
 * in the product). No index writes, no settings changes.
 */
import { readFileSync } from "node:fs";
import { fetchFacetSearch, searchMeili, LOCATION_FACET_FIELDS, JOBS_INDEX_SETTINGS } from "@/lib/jobs/meilisearch";
import { resolveLocationFacet } from "@/lib/jobs/query-understanding";
import { locationVocabulary } from "@/lib/jobs/search";
import { scanPlacePhrases } from "@/lib/geo/resolve-place";
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
type Verdict = "OK" | "UNDER" | "OVER" | "SKIP";

// The one place this cap is defined — see JOBS_INDEX_SETTINGS.pagination in
// meilisearch.ts. Reused, not re-typed, so this checker can never drift from
// the setting actually live on the index.
const MAX_TOTAL_HITS = JOBS_INDEX_SETTINGS.pagination.maxTotalHits;

interface Row {
  field: LocationField;
  value: string;
  arity: number;
  places: string[];
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

/**
 * Pure: classify one (advertised, delivered) pair given the value's arity.
 * See the header comment for why the rule differs by arity, and why an
 * advertised count at/over the pagination cap is skipped rather than judged.
 */
function classify(advertised: number, delivered: number, arity: number): Verdict {
  if (advertised >= MAX_TOTAL_HITS) return "SKIP";
  if (arity >= 2) {
    if (delivered === advertised) return "OK";
    return delivered < advertised ? "UNDER" : "OVER";
  }
  // arity 0 (no gazetteer-recognized place at all — a raw literal corpus
  // value like "Nederland") or arity 1 (one recognized place): both name a
  // SINGLE place, so deliberate widening is allowed — only under-delivery
  // is a violation.
  return delivered < advertised ? "UNDER" : "OK";
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
      // Same scanner `resolveLocationFacet` runs internally (via
      // parsePlaceTokens) — pure, no I/O, so this costs nothing extra and
      // can never disagree with what the resolver itself saw in this value.
      const { resolutions } = scanPlacePhrases(value, vocab.gazetteer, false);
      const arity = resolutions.length;
      const places = resolutions.map((r) => r.entity.name);
      const delivered = await deliveredCount(value, vocab);
      const verdict = classify(count, delivered, arity);
      rows.push({ field, value, arity, places, advertised: count, delivered, verdict });
      console.log(
        `${verdict.padEnd(5)} arity=${arity} ${field.padEnd(16)} ${JSON.stringify(value).padEnd(42)} advertised=${count} delivered=${delivered}`,
      );
    }
  }

  const skipped = rows.filter((r) => r.verdict === "SKIP");
  const arity1Violations = rows.filter((r) => r.arity <= 1 && r.verdict === "UNDER");
  const arity2PlusViolations = rows.filter((r) => r.arity >= 2 && (r.verdict === "UNDER" || r.verdict === "OVER"));

  if (skipped.length > 0) {
    console.log(`\nSkipped (advertised at/over the ${MAX_TOTAL_HITS} maxTotalHits cap — unverifiable, not judged):`);
    for (const r of skipped) {
      console.log(`  ${r.field}=${JSON.stringify(r.value)}  advertised=${r.advertised}`);
    }
  }

  if (arity1Violations.length > 0) {
    console.log("\nArity <=1 violations (single place — under-delivery only; widening is allowed):");
    for (const v of arity1Violations) {
      console.log(`  ${v.verdict}  ${v.field}=${JSON.stringify(v.value)}  advertised=${v.advertised} delivered=${v.delivered}`);
    }
  }

  if (arity2PlusViolations.length > 0) {
    console.log("\nArity >=2 violations (composite value — exact match required):");
    for (const v of arity2PlusViolations) {
      console.log(
        `  ${v.verdict}  ${v.field}=${JSON.stringify(v.value)}  advertised=${v.advertised} delivered=${v.delivered}  decomposed=[${v.places.join(", ")}]`,
      );
    }
  }

  console.log(
    `\nchecked=${rows.length} skipped-at-cap=${skipped.length} arity<=1 violations=${arity1Violations.length} arity>=2 violations=${arity2PlusViolations.length}`,
  );
  process.exit(arity1Violations.length + arity2PlusViolations.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
