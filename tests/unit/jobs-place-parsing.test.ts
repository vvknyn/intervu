import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyQueryUnderstanding,
  companyCorroborationCandidates,
  parsePlaceTokens,
  resolveLocationFacet,
  type CompanyProbe,
  type LocationVocabulary,
} from "../../src/lib/jobs/query-understanding";
import { applyLocationDefault, hasLocationSignal } from "../../src/lib/geo/ip-default";
import { buildFilter } from "../../src/lib/jobs/meilisearch";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import type { CorpusValueChecker } from "../../src/lib/geo/corpus-values";
import type { JobSearchParams, PlaceFilter } from "../../src/lib/jobs/types";

/** Small fixture gazetteer — Toronto/Ontario/Canada plus a real gazetteer
 *  city ("Lisbon") the fixture CORPUS below never validates, so it proves
 *  the corpus-validation layer (not just gazetteer recognition) gates the
 *  final filter. "Richmond Hill" is a radius neighbor of Toronto AND the
 *  name of a real Georgia, US city — the cross-country homonym bug fixture. */
const DATA: GazetteerData = {
  countries: [
    ["CA", "CAN", "Canada"],
    ["US", "USA", "United States"],
    ["AU", "AUS", "Australia"],
  ],
  admin1: [
    ["CA", "ON", "Ontario"],
    ["US", "FL", "Florida"], // the location-facet bug's surfacing instance (below)
    ["US", "GA", "Georgia"],
    ["AU", "NSW", "New South Wales"],
  ],
  cities: [
    ["Toronto", null, 43.70011, -79.4163, "CA", "ON", 2794356],
    ["Richmond Hill", null, 43.8828, -79.4403, "CA", "ON", 202022], // ~20km from Toronto — a radius neighbor
    // The foreign twins that make the homonym real rather than described.
    // `scopeCityCandidates` only scopes a name the gazetteer knows in more
    // than one country, so without these rows this fixture would assert a
    // country scope the real artifact applies for a reason the fixture
    // doesn't model (Richmond Hill: CA+US, Toronto: CA+AU).
    ["Richmond Hill", null, 31.9377, -81.3037, "US", "GA", 9281],
    ["Toronto", null, -33.0167, 151.5833, "AU", "NSW", 5386],
    ["New York", null, 40.7128, -74.006, "US", "NY", 8804190],
    ["Lisbon", null, 38.7223, -9.1393, "PT", null, 506654],
  ],
};
const GAZETTEER = buildGazetteerIndex(DATA);

/** Shaped like the live corpus (a small allowlist of real values) — every
 *  place below actually "exists"; everything else (Lisbon, radius
 *  neighbors the fixture gazetteer doesn't even define here) does not, so
 *  a resolved gazetteer candidate still has to clear this before becoming
 *  a filter. Deliberately country-BLIND per (field, value) — exactly how
 *  Meilisearch's facet-search really behaves: a "Richmond Hill" hit is one
 *  aggregate value regardless of how many different countries' postings
 *  contributed to it, which is exactly why the AND-scoping in
 *  query-understanding.ts (not this fake) is what has to keep them apart. */
/** Default company probe: never corroborates — matches production's real
 *  probe answering "no" for a corpus with no matching employer, and keeps
 *  every test that doesn't care about S1 corroboration behaving exactly as
 *  it did before that guard existed. */
const NEVER_CORROBORATES: CompanyProbe = async () => false;

function fakeVocab(
  realValues: PlaceFilter[],
  gazetteer = GAZETTEER,
  companyProbe: CompanyProbe = NEVER_CORROBORATES,
): LocationVocabulary {
  const checker: CorpusValueChecker = async (groups) =>
    groups.map((candidates) => {
      const seen = new Set<string>();
      const out: PlaceFilter[] = [];
      for (const c of candidates) {
        const hit = realValues.find((v) => v.field === c.field && v.value.toLowerCase() === c.value.toLowerCase());
        if (!hit) continue;
        const key = `${hit.field} ${hit.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(hit);
        }
      }
      return out;
    });
  return { gazetteer, corpusChecker: checker, companyProbe };
}

const VOCAB = fakeVocab([
  { field: "location_city", value: "Toronto" },
  { field: "location_city", value: "New York" },
  { field: "location_country", value: "Canada" },
  { field: "location_state", value: "Florida" },
  // A raw-ingest value with real corpus support but no matching GeoNames
  // place at all (an employer's ATS literally tags postings "Worldwide") —
  // the "value WITH corpus support keeps its exact facet" regression guard
  // below needs a literal the gazetteer can never resolve but the corpus
  // (this fake) genuinely has.
  { field: "location_country", value: "Worldwide" },
]);

test("the screenshot case: 'Technical Account Manager canada' becomes a Canada FILTER, not a content word", async () => {
  const { residualQ, places } = await parsePlaceTokens("Technical Account Manager canada", VOCAB);
  assert.equal(residualQ, "Technical Account Manager");
  assert.deepEqual(places, [{ any: [{ field: "location_country", value: "Canada" }] }]);
});

test("multi-word places match longest-first and leave the rest of the query alone", async () => {
  const { residualQ, places } = await parsePlaceTokens("senior engineer new york", VOCAB);
  assert.equal(residualQ, "senior engineer");
  assert.equal(places.length, 1);
  assert.deepEqual(places[0].any, [{ field: "location_city", value: "New York" }]);
  assert.equal(places[0].scopedToCountry, undefined, "New York's country (US) never validated in this fake corpus");
});

test("several places OR together; punctuation between them is irrelevant", async () => {
  const { residualQ, places } = await parsePlaceTokens("Product Manager - Toronto, Canada", VOCAB);
  assert.equal(residualQ, "Product Manager");
  assert.equal(places.length, 2);
  const filter = buildFilter({ q: residualQ, places });
  assert.ok(
    filter.some((f) => f.includes('location_city = "Toronto"') && f.includes('location_country = "Canada"') && f.includes(" OR ")),
    `Toronto and Canada must be OR'd together as separately-typed mentions: ${JSON.stringify(filter)}`,
  );
});

test("a query that is only a place browses that place — empty residual, filter set", async () => {
  const { residualQ, places } = await parsePlaceTokens("toronto", VOCAB);
  assert.equal(residualQ, "");
  assert.equal(places.length, 1);
});

test("cross-country homonym FIX: Toronto's 'Richmond Hill' radius match is scoped to Canada, so a same-named US row can never satisfy the filter", async () => {
  const vocab = fakeVocab([
    { field: "location_city", value: "Toronto" },
    { field: "location_city", value: "Richmond Hill" }, // aggregate hit — could be CA or US postings, facet-search can't tell
    { field: "location_country", value: "Canada" },
  ]);
  const { places } = await parsePlaceTokens("toronto", vocab);
  assert.equal(places.length, 1);
  const [clause] = places;
  assert.ok(
    clause.any.some((f) => f.field === "location_city" && f.value === "Richmond Hill"),
    `expected Richmond Hill in the city OR-set: ${JSON.stringify(clause)}`,
  );
  assert.ok(clause.scopedToCountry?.length, "must carry a country scope");
  assert.ok(clause.scopedToCountry!.some((f) => f.value === "Canada"));

  const filter = buildFilter({ q: "", places });
  const placeClause = filter.find((f) => f.includes("Richmond Hill"))!;
  assert.ok(placeClause, `expected a filter clause mentioning Richmond Hill: ${JSON.stringify(filter)}`);
  assert.match(
    placeClause,
    /\(.*location_city = "Richmond Hill".*\) AND \(.*location_country = "Canada".*\)/,
    `the city OR-group must be AND'd against the country OR-group, not left as a bare city match: ${placeClause}`,
  );
});

test("a real gazetteer place the corpus has no postings for produces no filter — and stays OUT of the query text, not back in as a content word (full-text matching on a bare place name is exactly what place filtering exists to avoid — see the module doc)", async () => {
  const { residualQ, places } = await parsePlaceTokens("product manager lisbon", VOCAB);
  assert.equal(residualQ, "product manager");
  assert.deepEqual(places, []);
});

test("a word the gazetteer has never heard of (not a recognized place at all) DOES survive as content", async () => {
  const { residualQ, places } = await parsePlaceTokens("product manager zzznotaplace", VOCAB);
  assert.equal(residualQ, "product manager zzznotaplace");
  assert.deepEqual(places, []);
});

test("applyQueryUnderstanding composes: work mode first, then places", async () => {
  const p = await applyQueryUnderstanding({ q: "remote react developer toronto" }, VOCAB);
  assert.deepEqual(p.facets?.work_type, ["remote"]);
  assert.equal(p.q, "react developer");
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "Toronto" }]);
});

test("an explicit country facet from the panel wins — typed place tokens stay in the query", async () => {
  const p = await applyQueryUnderstanding(
    { q: "product manager canada", facets: { location_country: ["United States"] } },
    VOCAB,
  );
  assert.equal(p.q, "product manager canada");
  assert.equal(p.places, undefined);
});

test("no vocabulary means no place parsing — never a crash, never a guess", async () => {
  const p = await applyQueryUnderstanding({ q: "product manager canada" });
  assert.equal(p.q, "product manager canada");
  assert.equal(p.places, undefined);
});

/* ------------ common-word guard: the "success" hijack, and its class ------------
 * Live bug: "customer success manager" with no location filter returned 19
 * results, all in Perth, Australia — "success" is a real Perth, WA suburb,
 * and the corpus-count floor (PLACE_MIN_COUNT) doesn't help because Success
 * has real matching docs and clears it easily (see GUARD_VOCAB below, which
 * validates every candidate unconditionally — worst case for the floor).
 * Only a guard upstream of the corpus check — resolvePlacePhrase's
 * `guardCommonWords`, threaded here as `applyQueryUnderstanding`'s free-text
 * path — closes this class.
 *
 * A DEDICATED gazetteer/vocab (not the shared GAZETTEER/VOCAB above): adding
 * "Engineer", "Mobile" etc. as real cities to the shared fixture would leak
 * into every OTHER test in this file that resolves without the guard flag
 * (e.g. "senior engineer new york" a few tests up) — the exact cross-test
 * version of the bug this guard fixes for production. */
const GUARD_DATA: GazetteerData = {
  countries: [
    ["AU", "AUS", "Australia"],
    ["US", "USA", "United States"],
    ["KE", "KEN", "Kenya"],
  ],
  admin1: [],
  cities: [
    ["Perth", null, -31.9505, 115.8605, "AU", null, 2059484],
    ["Success", null, -32.1058, 115.8492, "AU", null, 12000], // real Perth, WA suburb, ~17km out
    ["Mobile", null, 30.6944, -88.0431, "US", null, 187041], // real Mobile, Alabama
    ["Engineer", null, -0.05, 37.6667, "KE", null, 5324], // real Engineer, Kenya (see geo-corpus-validation.test.ts)
    ["Enterprise", null, 31.315, -85.8552, "US", null, 26899], // real Enterprise, Alabama — the job-vocab class (below)
  ],
};
const GUARD_GAZETTEER = buildGazetteerIndex(GUARD_DATA);
const GUARD_VOCAB = fakeVocab(
  [
    { field: "location_city", value: "Perth" },
    { field: "location_city", value: "Success" },
    { field: "location_city", value: "Mobile" },
    { field: "location_city", value: "Engineer" },
    { field: "location_city", value: "Enterprise" },
  ],
  GUARD_GAZETTEER,
);

test("the live bug: 'customer success manager' free text never treats \"success\" as a place — all three role words survive", async () => {
  const p = await applyQueryUnderstanding({ q: "customer success manager" }, GUARD_VOCAB);
  assert.equal(p.q, "customer success manager");
  assert.equal(p.places, undefined);
});

test("'mobile developer': 'mobile' (a real Mobile, Alabama) is not extracted as a place from free text", async () => {
  const p = await applyQueryUnderstanding({ q: "mobile developer" }, GUARD_VOCAB);
  assert.equal(p.q, "mobile developer");
  assert.equal(p.places, undefined);
});

test("bare 'engineer' (a real Engineer, Kenya) is not extracted as a place from free text", async () => {
  const p = await applyQueryUnderstanding({ q: "engineer" }, GUARD_VOCAB);
  assert.equal(p.q, "engineer");
  assert.equal(p.places, undefined);
});

test("job-vocab tier: 'enterprise account executive' — \"enterprise\" (a real Enterprise, Alabama; NOT in the common-English list) is caught by the corpus-derived job vocabulary", async () => {
  const p = await applyQueryUnderstanding({ q: "enterprise account executive" }, GUARD_VOCAB);
  assert.equal(p.q, "enterprise account executive");
  assert.equal(p.places, undefined);
});

test("'head of customer success': no place extracted, full residual survives", async () => {
  const p = await applyQueryUnderstanding({ q: "head of customer success" }, GUARD_VOCAB);
  assert.equal(p.q, "head of customer success");
  assert.equal(p.places, undefined);
});

test("control: 'barista toronto' still extracts Toronto — the guard doesn't touch real place words", async () => {
  const p = await applyQueryUnderstanding({ q: "barista toronto" }, VOCAB);
  assert.equal(p.q, "barista");
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "Toronto" }]);
});

test("control: 'nurse perth' still extracts Perth — Perth isn't an English common word", async () => {
  const p = await applyQueryUnderstanding({ q: "nurse perth" }, GUARD_VOCAB);
  assert.equal(p.q, "nurse");
  assert.equal(p.places?.length, 1);
  assert.ok(
    p.places![0].any.some((f) => f.field === "location_city" && f.value === "Perth"),
    `expected Perth in the resolved place: ${JSON.stringify(p.places)}`,
  );
});

test("control: 'new york analyst' still extracts New York — multi-word candidates are exempt from the guard", async () => {
  const p = await applyQueryUnderstanding({ q: "new york analyst" }, VOCAB);
  assert.equal(p.q, "analyst");
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "New York" }]);
});

/* ------------ the board's location box: `facets.location_country` ------------
 * Live bug (prod screenshot, 2026-08-08): typing "florida" into /jobs'
 * location input returned "Nothing matches these filters" against a 1.8M-row
 * corpus. `commitLocation` (app/jobs/page.tsx) writes the raw typed text into
 * `facets.location_country`, an EXACT-match country facet — so every STATE,
 * CITY and abbreviation zeroed out, and only whole country names appeared to
 * work (Meilisearch string comparison being case-insensitive). Fixed at the
 * request-understanding chokepoint, `resolveLocationFacet`, so every caller
 * of `searchJobs` inherits it and the URL/state shape is untouched. */

test("the screenshot case: a typed STATE ('florida') becomes a location_state place clause and the raw country facet is dropped", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["florida"] } }, VOCAB);
  assert.deepEqual(p.places, [{ any: [{ field: "location_state", value: "Florida" }] }]);
  assert.equal(p.facets?.location_country, undefined, "the raw exact-match facet must not survive alongside the clause");
  const filter = buildFilter(p);
  assert.ok(
    filter.some((f) => f.includes('location_state = "Florida"')),
    `expected a location_state clause: ${JSON.stringify(filter)}`,
  );
  assert.ok(
    !filter.some((f) => f.includes("location_country = \"florida\"")),
    `the raw exact country filter is what returned zero — it must be gone: ${JSON.stringify(filter)}`,
  );
});

test("not just the surfacing instance — a typed CITY ('toronto') resolves the same way", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["toronto"] } }, VOCAB);
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "Toronto" }]);
  // Exact-facet-value-first (below) resolves "toronto" by literal identity —
  // it IS a known location_city value — before the gazetteer/scoping path
  // ever runs, so no scopedToCountry here. Country-homonym scoping still
  // fully applies to the gazetteer-driven path (parsePlaceTokens directly,
  // and any typed phrase that ISN'T itself an exact facet value) — see the
  // "cross-country homonym FIX" test above, unaffected by this change.
  assert.equal(p.places![0].scopedToCountry, undefined);
  assert.equal(p.facets?.location_country, undefined);
});

test("a typed COUNTRY ('canada') goes through resolution too — the corpus's own casing, not the typed casing", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["canada"] } }, VOCAB);
  assert.deepEqual(p.places, [{ any: [{ field: "location_country", value: "Canada" }] }]);
  assert.equal(p.facets?.location_country, undefined);
});

test("case-insensitive: 'FLORIDA' resolves identically to 'florida'", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["  FLORIDA  "] } }, VOCAB);
  assert.deepEqual(p.places, [{ any: [{ field: "location_state", value: "Florida" }] }]);
});

test("unresolvable text is DROPPED, not kept as a doomed exact facet — and reported so the caller can tell the searcher (the 'North America' bug's general fix)", async () => {
  const params: JobSearchParams = { facets: { location_country: ["zzznotaplace"] } };
  const p = await resolveLocationFacet(params, VOCAB);
  assert.equal(
    p.facets?.location_country,
    undefined,
    "the raw exact-match facet must not survive — the live corpus has no such value, so it could only ever match zero rows",
  );
  assert.equal(p.places, undefined);
  assert.deepEqual(p.unmatchedPlaceMentions, ["zzznotaplace"]);
});

test("a real gazetteer place this corpus has no postings for is ALSO dropped and reported, not kept as a raw facet (never invents a filter)", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["lisbon"] } }, VOCAB);
  assert.equal(p.facets?.location_country, undefined);
  assert.equal(p.places, undefined);
  assert.deepEqual(p.unmatchedPlaceMentions, ["lisbon"]);
});

test("a value WITH corpus support keeps its exact facet (no regression): a raw-ingest literal the gazetteer can't resolve as any place, but the corpus genuinely has, still becomes a filter", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["worldwide"] } }, VOCAB);
  assert.deepEqual(p.places, [{ any: [{ field: "location_country", value: "Worldwide" }] }]);
  assert.equal(p.facets?.location_country, undefined);
  assert.equal(p.unmatchedPlaceMentions, undefined, "a value the corpus actually has is never reported as unmatched");
});

/* ------------ exact-facet-value-first ------------
 * Live bug (prod, 2026-08-26): `country=US CA San Diego` — a real,
 * typeahead-advertised `location_city` facet value with only 96 postings —
 * returned the full US count (982,249) instead of San Diego's narrow count
 * (5,088). `parsePlaceTokens`' greedy scanner tokenized the compound into
 * "US" (country) OR "San Diego" (city), discarding "CA" — and the UNION of
 * those two clauses equals the whole-US count, with the filter chip still
 * looking applied. Fixed by trying the WHOLE typed string as an exact known
 * facet value first (`resolveExactFacetValue`), before any tokenizing runs;
 * only when nothing matches verbatim does resolution fall through to
 * `parsePlaceTokens`. Own fixture (not the shared VOCAB above), so the
 * compound literal it adds can't leak into other tests' assertions.
 */
const STRUCTURED_VOCAB = fakeVocab([
  { field: "location_country", value: "Canada" },
  // Bare "Toronto" is also real corpus support — needed so the control test
  // below can prove the compound genuinely fragments into BOTH tokens (not
  // just "Canada"), the same shape as the live bug's "US" + "San Diego" split.
  { field: "location_city", value: "Toronto" },
  // The compound literal itself: a real corpus value distinct from (and, in
  // production, far smaller than) "Canada" alone — this fixture's stand-in
  // for "US CA San Diego", built from a NON-US country to prove the fix
  // isn't US-specific.
  { field: "location_city", value: "Canada Toronto" },
]);

test("exact-facet-value-first: a structured compound value ('Canada Toronto') resolves to ITSELF, not the broader country its own tokens would separately match", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["Canada Toronto"] } }, STRUCTURED_VOCAB);
  assert.deepEqual(p.places, [{ any: [{ field: "location_city", value: "Canada Toronto" }] }]);
});

test("exact-facet-value-first: confirms the fixture actually exercises the bug's mechanism — tokenizing this same compound (the path resolveLocationFacet no longer tries first) really does fragment it into Canada OR Toronto", async () => {
  const { places } = await parsePlaceTokens("Canada Toronto", STRUCTURED_VOCAB);
  assert.equal(places.length, 2, "the tokenizer finds Canada and Toronto as two separate clauses, not one");
  assert.ok(places.some((c) => c.any.some((f) => f.value === "Canada")));
  assert.ok(places.some((c) => c.any.some((f) => f.value === "Toronto")));
});

test("exact-facet-value-first: a phrase that is NOT itself a literal facet value still falls through to tokenizing — 'usa' resolves via the country alias exactly as it always did", async () => {
  const vocab = fakeVocab([{ field: "location_country", value: "United States" }]);
  const p = await resolveLocationFacet({ facets: { location_country: ["usa"] } }, vocab);
  assert.deepEqual(p.places, [{ any: [{ field: "location_country", value: "United States" }] }]);
});

test("no location facet at all (or an empty/whitespace one) is a no-op", async () => {
  const browse = { q: "product manager" };
  assert.equal(await resolveLocationFacet(browse, VOCAB), browse);
  const blank = { facets: { location_country: ["   "] } };
  assert.equal(await resolveLocationFacet(blank, VOCAB), blank);
});

test("only the location facet is dropped — every other facet the searcher picked survives", async () => {
  const p = await resolveLocationFacet(
    { q: "nurse", facets: { location_country: ["florida"], work_type: ["remote"] } },
    VOCAB,
  );
  assert.deepEqual(p.facets?.work_type, ["remote"]);
  assert.equal(p.facets?.location_country, undefined);
  assert.equal(p.q, "nurse", "the query text is this function's business to leave alone");
});

test("multi-value facet (a `?location_country=a,b` deep link): all resolve -> one OR-group per value", async () => {
  const both = await resolveLocationFacet({ facets: { location_country: ["florida", "canada"] } }, VOCAB);
  assert.deepEqual(both.places, [
    { any: [{ field: "location_state", value: "Florida" }] },
    { any: [{ field: "location_country", value: "Canada" }] },
  ]);
  assert.ok(
    buildFilter(both).some((f) => f.includes('location_state = "Florida"') && f.includes('location_country = "Canada"') && f.includes(" OR ")),
    "the two values must OR together, exactly like two typed mentions",
  );
});

test("multi-value facet, mixed: each value resolves INDEPENDENTLY — one bad value no longer poisons its siblings (the AND-poisoning class this replaces: a raw facet left standing beside a resolved OR-group would AND against it and zero the search out)", async () => {
  const mixed = { facets: { location_country: ["florida", "zzznotaplace"] } };
  const p = await resolveLocationFacet(mixed, VOCAB);
  assert.deepEqual(p.places, [{ any: [{ field: "location_state", value: "Florida" }] }], "florida still resolves despite its sibling failing");
  assert.deepEqual(p.unmatchedPlaceMentions, ["zzznotaplace"]);
  assert.equal(p.facets?.location_country, undefined);
});

test("interaction with the IP country default: a resolved place IS location signal, so a Florida search never gets a country default stacked on top", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["florida"] } }, VOCAB);
  assert.equal(hasLocationSignal(p), true);
  const applied = await applyLocationDefault(p, "8.8.8.8", async () => "CA", async () => {
    throw new Error("resolveLocationDefault must never be reached for an explicit place");
  });
  assert.equal(applied.params, p);
  assert.equal(applied.defaultedLocation, undefined);
});

test("F1: 'remote' in the location box routes to work_type, not a location filter", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["remote"] } }, VOCAB);
  assert.deepEqual(p.facets?.work_type, ["remote"]);
  assert.equal(p.facets?.location_country, undefined);
  assert.equal(p.places, undefined);
});

test("F1: case-insensitive — 'Remote' resolves identically", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["Remote"] } }, VOCAB);
  assert.deepEqual(p.facets?.work_type, ["remote"]);
});

test("F1: 'hybrid' in the location box also routes to work_type", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["hybrid"] } }, VOCAB);
  assert.deepEqual(p.facets?.work_type, ["hybrid"]);
});

test("F1: mixed 'remote canada' -> a Canada place clause carrying the work mode", async () => {
  // The work mode used to land in a GLOBAL `work_type` facet. It now binds
  // to the clause for the place it was typed with. For a single phrase the
  // two are the same set — `(remote) AND (Canada)` vs `((Canada) AND
  // (remote))` — so this is a change of representation, not of results;
  // what it buys is the two-place case, where a global facet cannot say
  // "remote in Canada, hybrid in Toronto" at all.
  const p = await resolveLocationFacet({ facets: { location_country: ["remote canada"] } }, VOCAB);
  assert.deepEqual(p.places, [
    { any: [{ field: "location_country", value: "Canada" }], workTypes: ["remote"] },
  ]);
  assert.equal(p.facets?.work_type, undefined, "bound, so nothing pools globally");
  assert.equal(p.facets?.location_country, undefined);

  // Equivalence guard: both constraints still reach the rendered filter.
  const clause = buildFilter(p).find((f) => f.includes("location_country"))!;
  assert.ok(clause.includes('location_country = "Canada"'), clause);
  assert.ok(clause.includes('work_type = "remote"'), clause);
});

test("F1 class case: plain 'canada' (no work-mode term) is untouched by the work-mode path", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["canada"] } }, VOCAB);
  assert.deepEqual(p.places, [{ any: [{ field: "location_country", value: "Canada" }] }]);
  assert.equal(p.facets?.work_type, undefined);
});

test("F1: a work-mode term merges with an already-selected work_type facet rather than overwriting it", async () => {
  const p = await resolveLocationFacet(
    { facets: { location_country: ["remote"], work_type: ["onsite"] } },
    VOCAB,
  );
  assert.deepEqual(p.facets?.work_type?.sort(), ["onsite", "remote"]);
});

test("explicit location intent bypasses the guard entirely: resolving \"success\" through parsePlaceTokens without the free-text flag (exactly how resolvePlaces/agent/tools.ts calls it for the MCP `location` param) still returns the place", async () => {
  const { residualQ, places } = await parsePlaceTokens("success", GUARD_VOCAB); // no 3rd arg — same call shape as resolvePlaces()
  assert.equal(residualQ, "");
  assert.equal(places.length, 1);
  assert.ok(
    places[0].any.some((f) => f.field === "location_city" && f.value === "Success"),
    `expected Success in the resolved place: ${JSON.stringify(places)}`,
  );
});

/* ------------ S1: company corroboration guard ------------
 * Live bug (search-audit.md class 1): "cleveland clinic" resolved
 * "cleveland" to Cleveland the city (a real GeoNames city — not blocked by
 * the common-word guard, since "cleveland" is neither common English nor
 * corpus job-title vocabulary) and left "clinic" prefix-matching any
 * "Clinical ___" job — zero of the top results were the real employer, and
 * the bare-Meili control (no query understanding at all) got it right. Own
 * fixture: Cleveland/Boston/Dallas as real gazetteer cities, mirroring the
 * audit's exact query set so these tests double as the gate evidence.
 */
const S1_DATA: GazetteerData = {
  countries: [["US", "USA", "United States"]],
  admin1: [],
  cities: [
    ["Cleveland", null, 41.4993, -81.6944, "US", null, 372624],
    ["Boston", null, 42.3601, -71.0589, "US", null, 675647],
    ["Dallas", null, 32.7767, -96.797, "US", null, 1304379],
  ],
};
const S1_GAZETTEER = buildGazetteerIndex(S1_DATA);
const S1_REAL_PLACES: PlaceFilter[] = [
  { field: "location_city", value: "Cleveland" },
  { field: "location_city", value: "Boston" },
  { field: "location_city", value: "Dallas" },
];

/** Fake company probe: corroborates only the exact phrases listed — stands
 *  in for `probeCompanyMatch`'s live company-field search (meilisearch.ts). */
function fakeCompanyProbe(matches: string[]): CompanyProbe {
  const set = new Set(matches.map((m) => m.toLowerCase()));
  return async (phrase) => set.has(phrase.toLowerCase());
}

test("S1 headline: 'cleveland clinic' — the employer wins, no place filter, the phrase survives whole as free text", async () => {
  const vocab = fakeVocab(S1_REAL_PLACES, S1_GAZETTEER, fakeCompanyProbe(["cleveland clinic"]));
  const p = await applyQueryUnderstanding({ q: "cleveland clinic" }, vocab);
  assert.equal(p.q, "cleveland clinic");
  assert.equal(p.places, undefined);
});

test("S1: 'boston consulting' — same class, a different city+company pair", async () => {
  const vocab = fakeVocab(S1_REAL_PLACES, S1_GAZETTEER, fakeCompanyProbe(["boston consulting"]));
  const p = await applyQueryUnderstanding({ q: "boston consulting" }, vocab);
  assert.equal(p.q, "boston consulting");
  assert.equal(p.places, undefined);
});

test("S1 control: 'warehouse jobs in dallas' — no corroborating company, Dallas STILL filters", async () => {
  const vocab = fakeVocab(S1_REAL_PLACES, S1_GAZETTEER, fakeCompanyProbe([]));
  const p = await applyQueryUnderstanding({ q: "warehouse jobs in dallas" }, vocab);
  assert.equal(p.q, "warehouse jobs in");
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "Dallas" }]);
});

test("S1 control: 'jobs in boston' — place still applies", async () => {
  const vocab = fakeVocab(S1_REAL_PLACES, S1_GAZETTEER, fakeCompanyProbe([]));
  const p = await applyQueryUnderstanding({ q: "jobs in boston" }, vocab);
  assert.equal(p.q, "jobs in");
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "Boston" }]);
});

test("S1 control: a bare single-word 'cleveland' is unchanged — nothing to corroborate against, the probe is never even asked", async () => {
  const vocab = fakeVocab(S1_REAL_PLACES, S1_GAZETTEER, async () => {
    throw new Error("companyProbe must never be called for a single-word query");
  });
  const p = await applyQueryUnderstanding({ q: "cleveland" }, vocab);
  assert.equal(p.q, "");
  assert.equal(p.places?.length, 1);
});

test("S1: explicit location-field intent (parsePlaceTokens without guardFreeTextWords, exactly how resolvePlaces/agent/tools.ts calls it) bypasses corroboration entirely, even for an ambiguous phrase", async () => {
  const vocab = fakeVocab(S1_REAL_PLACES, S1_GAZETTEER, fakeCompanyProbe(["cleveland clinic"]));
  const { residualQ, places } = await parsePlaceTokens("cleveland clinic", vocab); // no 3rd arg
  assert.equal(residualQ, "clinic");
  assert.equal(places.length, 1);
});

test("companyCorroborationCandidates: the after-match candidate is tried before the before-match one", () => {
  assert.deepEqual(
    companyCorroborationCandidates(
      { entity: { type: "city", name: "Cleveland", countryCode: "US" }, candidates: [], countryScope: [], wordsConsumed: 1, startIndex: 1 },
      ["nurse", "cleveland", "clinic"],
    ),
    ["cleveland clinic", "nurse cleveland"],
  );
});

test("companyCorroborationCandidates: no adjacent token on either side yields no candidates", () => {
  assert.deepEqual(
    companyCorroborationCandidates(
      { entity: { type: "city", name: "Cleveland", countryCode: "US" }, candidates: [], countryScope: [], wordsConsumed: 1, startIndex: 0 },
      ["cleveland"],
    ),
    [],
  );
});

test("companyCorroborationCandidates: a function-word neighbor ('in') is skipped — no candidate built from it", () => {
  assert.deepEqual(
    companyCorroborationCandidates(
      { entity: { type: "city", name: "Dallas", countryCode: "US" }, candidates: [], countryScope: [], wordsConsumed: 1, startIndex: 3 },
      ["warehouse", "jobs", "in", "dallas"],
    ),
    [],
  );
});

test("S1 REGRESSION (live-discovered): Meilisearch's own stop-words list ('in','at','of'...) drops a function word from a company query — so 'in dallas' would falsely corroborate against ANY unrelated Dallas-adjacent company. The guard must skip that candidate, not just happen to get a 'false' answer from a lenient fake probe", async () => {
  // This probe answers exactly like the live bug: it corroborates on the
  // PLACE WORD ALONE once a function-word neighbor is (wrongly) reduced to
  // nothing — proving Dallas survives because the candidate is never even
  // asked, not because this particular fake happens to say no.
  const stopWordCollapseProbe: CompanyProbe = async (phrase) => /dallas/i.test(phrase);
  const vocab = fakeVocab(S1_REAL_PLACES, S1_GAZETTEER, stopWordCollapseProbe);
  const p = await applyQueryUnderstanding({ q: "warehouse jobs in dallas" }, vocab);
  assert.equal(p.q, "warehouse jobs in");
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "Dallas" }]);
});

/* ────────────────────────────────────────────────────────────────────────
 * Multi-place filtering, and work modes bound to the place they were typed
 * with. Reported as two gaps in the same journey: "there is no way to do
 * multiple location searches like (Canada and remote) and (US & hybrid)".
 * ──────────────────────────────────────────────────────────────────────── */

test("several chosen places OR together — the list has always been supported end to end", async () => {
  const p = await resolveLocationFacet(
    { facets: { location_country: ["toronto", "canada"] } },
    VOCAB,
  );
  assert.equal(p.places?.length, 2, "each chosen place resolves to its own clause");
  // The exact facet is consumed — leaving it would AND a raw string against
  // the resolved clauses and match nothing.
  assert.equal(p.facets?.location_country, undefined);
  const filter = buildFilter(p);
  assert.ok(
    filter.some((f) => f.includes('location_city = "Toronto"') && f.includes('location_country = "Canada"') && f.includes(" OR ")),
    `both places must appear in ONE OR group: ${JSON.stringify(filter)}`,
  );
});

test("a work mode typed with a place binds to THAT place, not to the whole query", async () => {
  const p = await resolveLocationFacet(
    { facets: { location_country: ["remote canada", "hybrid toronto"] } },
    VOCAB,
  );
  assert.equal(p.places?.length, 2);

  const canada = p.places!.find((c) => c.any.some((a) => a.value === "Canada"))!;
  const toronto = p.places!.find((c) => c.any.some((a) => a.value === "Toronto"))!;
  assert.deepEqual(canada.workTypes, ["remote"]);
  assert.deepEqual(toronto.workTypes, ["hybrid"]);

  // The whole point: NO global work_type facet, because a global one would
  // read (remote OR hybrid) AND (Canada OR Toronto) and hand back remote
  // Toronto roles that were never asked for.
  assert.equal(p.facets?.work_type, undefined, "work modes must not pool into a global facet");
});

test("the bound work mode reaches the rendered filter, AND-ed inside its own place clause", async () => {
  const p = await resolveLocationFacet(
    { facets: { location_country: ["remote canada", "hybrid toronto"] } },
    VOCAB,
  );
  const places = buildFilter(p).find((f) => f.includes("location_country"))!;
  assert.ok(places.includes('work_type = "remote"'), places);
  assert.ok(places.includes('work_type = "hybrid"'), places);
  // Each mode sits inside the clause for its own place: the substring from
  // Canada to the next clause boundary must carry "remote" and not "hybrid".
  const canadaFirst = places.indexOf('location_country = "Canada"');
  const torontoAt = places.indexOf('location_city = "Toronto"');
  const [lo, hi] = canadaFirst < torontoAt ? [canadaFirst, torontoAt] : [torontoAt, canadaFirst];
  const firstClause = places.slice(lo, hi);
  const firstMode = canadaFirst < torontoAt ? "remote" : "hybrid";
  assert.ok(firstClause.includes(`work_type = "${firstMode}"`), `first clause should carry only its own mode: ${firstClause}`);
});

test("a SINGLE place with a work mode is unchanged in meaning — the one-location case still works", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["remote canada"] } }, VOCAB);
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].workTypes, ["remote"]);
  // (place AND remote) and (remote) AND (place) are the same set; binding it
  // is what makes the two-place case expressible without changing this one.
  const filter = buildFilter(p);
  const clause = filter.find((f) => f.includes("location_country"))!;
  assert.ok(clause.includes('work_type = "remote"'), clause);
});

test("a work mode with no place of its own stays global — nothing to bind it to", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["remote"] } }, VOCAB);
  assert.equal(p.places, undefined, "pure work-mode text filters no place");
  assert.deepEqual(p.facets?.work_type, ["remote"]);
});

test("place text that does not resolve leaves its work mode global rather than dropping it", async () => {
  // "lisbon" is in the fixture gazetteer but never validated by the fixture
  // corpus, so it resolves to nothing. The mode we DID understand must
  // still apply.
  const p = await resolveLocationFacet({ facets: { location_country: ["remote lisbon"] } }, VOCAB);
  assert.deepEqual(p.facets?.work_type, ["remote"]);
  assert.deepEqual(p.unmatchedPlaceMentions, ["lisbon"], "the residual that failed to resolve is still reported");
});

test("the Work-mode dropdown's own selection stays global alongside a bound one", async () => {
  // Different questions: "remote anywhere" (dropdown) vs "hybrid in
  // Toronto" (typed). Both remain askable, and both apply.
  const p = await resolveLocationFacet(
    { facets: { location_country: ["hybrid toronto"], work_type: ["remote"] } },
    VOCAB,
  );
  assert.deepEqual(p.facets?.work_type, ["remote"], "the dropdown's choice is untouched");
  assert.deepEqual(p.places![0].workTypes, ["hybrid"]);
});

test("a clause with no work mode renders exactly the string it always did", async () => {
  // Guards the renderer's shape change: the multi-part parenthesised form is
  // reserved for clauses that actually have extra parts.
  const p = await resolveLocationFacet({ facets: { location_country: ["canada"] } }, VOCAB);
  const filter = buildFilter(p);
  assert.ok(
    filter.some((f) => f === '((location_country = "Canada"))'),
    `unchanged single-group rendering expected: ${JSON.stringify(filter)}`,
  );
});
