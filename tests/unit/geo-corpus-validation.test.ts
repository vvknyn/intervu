import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCorpusValueChecker,
  foldForMatch,
  selectMatchingHits,
  PLACE_MIN_COUNT,
  type FacetHit,
  type FacetSearchFetcher,
} from "../../src/lib/geo/corpus-values";
import type { PlaceCandidate } from "../../src/lib/geo/resolve-place";

test("selectMatchingHits: exact mode keeps every spelling that folds alike, in the CORPUS's own casing", () => {
  const hits: FacetHit[] = [{ value: "MISSISSAUGA", count: 1306 }, { value: "Mississauga Heights", count: 4 }];
  const candidate: PlaceCandidate = { field: "location_city", value: "Mississauga" };
  assert.deepEqual(selectMatchingHits(candidate, hits), [{ field: "location_city", value: "MISSISSAUGA" }]);
});

test("selectMatchingHits: no matching hit means no filter — never invents one", () => {
  const hits: FacetHit[] = [{ value: "Toronto", count: 500 }];
  const candidate: PlaceCandidate = { field: "location_city", value: "Nowhereville" };
  assert.deepEqual(selectMatchingHits(candidate, hits), []);
});

test("selectMatchingHits: an exact match below PLACE_MIN_COUNT is rejected — the class fix for a common word that happens to name an obscure real place ('Engineer', Kenya, pop. 5,324, but only 2 corpus postings)", () => {
  const hits: FacetHit[] = [{ value: "Engineer", count: 2 }];
  const candidate: PlaceCandidate = { field: "location_city", value: "Engineer" };
  assert.deepEqual(selectMatchingHits(candidate, hits), []);
  assert.ok(2 < PLACE_MIN_COUNT);
});

test("selectMatchingHits: an exact match AT the floor still counts (not a strict-below-only off-by-one)", () => {
  const hits: FacetHit[] = [{ value: "Springfield", count: PLACE_MIN_COUNT }];
  const candidate: PlaceCandidate = { field: "location_city", value: "Springfield" };
  assert.deepEqual(selectMatchingHits(candidate, hits), [{ field: "location_city", value: "Springfield" }]);
});

test("selectMatchingHits: prefix mode also keeps every real compound value ('Canada - Remote', 'Canada - Toronto') — no count floor, since the compound string can only exist if the corpus really has it", () => {
  const hits: FacetHit[] = [
    { value: "Canada", count: 34130 },
    { value: "Canada - Remote", count: 175 },
    { value: "Canada - Toronto", count: 55 }, // below PLACE_MIN_COUNT but still kept — a compound match, not exact
    { value: "Canadian Border Area", count: 3 }, // does NOT start with "Canada - "
  ];
  const candidate: PlaceCandidate = { field: "location_country", value: "Canada", matchMode: "prefix" };
  assert.deepEqual(
    selectMatchingHits(candidate, hits).map((f) => f.value).sort(),
    ["Canada", "Canada - Remote", "Canada - Toronto"].sort(),
  );
});

test("selectMatchingHits: exact mode (no matchMode) does NOT pick up compound values", () => {
  const hits: FacetHit[] = [{ value: "Canada", count: 34130 }, { value: "Canada - Remote", count: 175 }];
  const candidate: PlaceCandidate = { field: "location_country", value: "Canada" };
  assert.deepEqual(selectMatchingHits(candidate, hits), [{ field: "location_country", value: "Canada" }]);
});

function stubFetcher(
  data: Record<string, FacetHit[]>,
): { fetcher: FacetSearchFetcher; calls: Array<{ field: string; query: string }> } {
  const calls: Array<{ field: string; query: string }> = [];
  const fetcher: FacetSearchFetcher = async (field, query) => {
    calls.push({ field, query });
    return data[`${field}:${query.toLowerCase()}`] ?? [];
  };
  return { fetcher, calls };
}

test("createCorpusValueChecker: candidate absent from the corpus never becomes a clause", async () => {
  const { fetcher } = stubFetcher({});
  const checker = createCorpusValueChecker(fetcher);
  const [result] = await checker([[{ field: "location_city", value: "Nowhereville" }]]);
  assert.deepEqual(result, []);
});

test("createCorpusValueChecker: validates a whole expansion set, keeping only what the corpus actually has (respecting the count floor)", async () => {
  const { fetcher } = stubFetcher({
    "location_city:toronto": [{ value: "Toronto", count: 5183 }],
    "location_city:markham": [{ value: "Markham", count: 349 }],
    "location_city:brampton": [], // resolver proposed it; corpus has nothing tagged this way
    "location_city:engineer": [{ value: "Engineer", count: 2 }], // exists, but too sparse to trust
  });
  const checker = createCorpusValueChecker(fetcher);
  const [result] = await checker([
    [
      { field: "location_city", value: "Toronto" },
      { field: "location_city", value: "Markham" },
      { field: "location_city", value: "Brampton" },
      { field: "location_city", value: "Engineer" },
    ],
  ]);
  assert.deepEqual(
    result.map((f) => f.value).sort(),
    ["Markham", "Toronto"],
  );
});

test("createCorpusValueChecker: repeat candidates hit the cache — one network call per unique (field, value), even across different groups in the same call", async () => {
  const { fetcher, calls } = stubFetcher({ "location_city:toronto": [{ value: "Toronto", count: 5183 }] });
  const checker = createCorpusValueChecker(fetcher);
  await checker([[{ field: "location_city", value: "Toronto" }]]);
  await checker([[{ field: "location_city", value: "Toronto" }]]);
  await checker([
    [{ field: "location_city", value: "toronto" }], // different casing, same corpus query
    [{ field: "location_city", value: "Toronto" }], // second group, same call
  ]);
  assert.equal(calls.length, 1, `expected exactly one fetch, got ${JSON.stringify(calls)}`);
});

test("createCorpusValueChecker: a fetch failure (null) fails the candidate open and is not cached as a false negative", async () => {
  let callCount = 0;
  const fetcher: FacetSearchFetcher = async () => {
    callCount += 1;
    return callCount === 1 ? null : [{ value: "Toronto", count: 5183 }];
  };
  const checker = createCorpusValueChecker(fetcher);
  const [first] = await checker([[{ field: "location_city", value: "Toronto" }]]);
  assert.deepEqual(first, [], "first call: fetch failed, candidate resolves to nothing");
  const [second] = await checker([[{ field: "location_city", value: "Toronto" }]]);
  assert.deepEqual(second, [{ field: "location_city", value: "Toronto" }], "retried, not stuck on a cached failure");
});

test("createCorpusValueChecker: duplicate resulting filters within a group are deduped — the exact and prefix candidates resolveCountry emits for the same name both match the plain 'Canada' hit", async () => {
  const { fetcher } = stubFetcher({
    "location_country:canada": [
      { value: "Canada", count: 34130 },
      { value: "Canada - Remote", count: 175 },
    ],
  });
  const checker = createCorpusValueChecker(fetcher);
  const [result] = await checker([
    [
      { field: "location_country", value: "Canada" },
      { field: "location_country", value: "Canada", matchMode: "prefix" },
    ],
  ]);
  assert.deepEqual(
    result.map((f) => f.value).sort(),
    ["Canada", "Canada - Remote"],
  );
});

test("createCorpusValueChecker: groups validate independently — one group's result never leaks into another's", async () => {
  const { fetcher } = stubFetcher({
    "location_city:richmond hill": [
      { value: "Richmond Hill", count: 900 }, // pretend the corpus only tags the Ontario one this way
    ],
    "location_country:canada": [{ value: "Canada", count: 34130 }],
    "location_country:kenya": [], // no Kenya postings at all
  });
  const checker = createCorpusValueChecker(fetcher);
  const [cityGroup, countryGroup, otherCountryGroup] = await checker([
    [{ field: "location_city", value: "Richmond Hill" }],
    [{ field: "location_country", value: "Canada" }],
    [{ field: "location_country", value: "Kenya" }],
  ]);
  assert.deepEqual(cityGroup, [{ field: "location_city", value: "Richmond Hill" }]);
  assert.deepEqual(countryGroup, [{ field: "location_country", value: "Canada" }]);
  assert.deepEqual(otherCountryGroup, []);
});

// ---------------------------------------------------------------------------
// Accent folding (2026-08-24).
//
// Meilisearch's facet FILTER is accent-SENSITIVE while its facet SEARCH is
// accent-INsensitive. Verified live: filtering `location_city = "Montreal"`
// returns 2,306 rows and `"Montréal"` returns 1,208, and the two sets are
// provably disjoint (their union equals their sum exactly, 3,514) — yet ONE
// facet-search returns both spellings. So a searcher who types either one is
// silently shown roughly half the city, with no way to tell.
// ---------------------------------------------------------------------------

test("foldForMatch strips diacritics and case, and is a general transform (not a city list)", () => {
  assert.equal(foldForMatch("Montréal"), "montreal");
  assert.equal(foldForMatch("MONTREAL"), "montreal");
  assert.equal(foldForMatch("  Lévis "), "levis");
  // Nothing here knows about French: any diacritic folds the same way.
  assert.equal(foldForMatch("Zürich"), "zurich");
  assert.equal(foldForMatch("São Paulo"), "sao paulo");
  assert.equal(foldForMatch("Kraków"), "krakow");
});

test("selectMatchingHits: one accented mention licenses EVERY corpus spelling of that place", () => {
  const hits: FacetHit[] = [
    { value: "Montreal", count: 2306 },
    { value: "Montréal", count: 1208 },
  ];
  for (const typed of ["Montreal", "Montréal", "MONTRÉAL"]) {
    const candidate: PlaceCandidate = { field: "location_city", value: typed };
    assert.deepEqual(
      selectMatchingHits(candidate, hits),
      [
        { field: "location_city", value: "Montreal" },
        { field: "location_city", value: "Montréal" },
      ],
      `typed "${typed}" must reach both spellings`,
    );
  }
});

// The OTHER bug the split caused, and a case other than the one that surfaced
// it: PLACE_MIN_COUNT is a claim about the PLACE, so splitting a place across
// spellings splits its evidence too and can push a real city under the floor.
test("selectMatchingHits: a fold group clears PLACE_MIN_COUNT together even when no single spelling does", () => {
  const hits: FacetHit[] = [
    { value: "Lévis", count: 62 },
    { value: "Levis", count: 39 },
  ];
  assert.ok(62 < PLACE_MIN_COUNT && 39 < PLACE_MIN_COUNT, "neither spelling clears the floor alone");
  assert.equal(62 + 39, 101);
  assert.deepEqual(selectMatchingHits({ field: "location_city", value: "Levis" }, hits), [
    { field: "location_city", value: "Lévis" },
    { field: "location_city", value: "Levis" },
  ]);
});

test("selectMatchingHits: a fold group still BELOW the floor licenses nothing — folding widens matching, never the floor", () => {
  const hits: FacetHit[] = [
    { value: "Nowhereville", count: 30 },
    { value: "Nowhervílle", count: 40 },
  ];
  assert.deepEqual(selectMatchingHits({ field: "location_city", value: "Nowhereville" }, hits), []);
});

test("selectMatchingHits: folding stays exact — a longer name that merely STARTS with the mention is not folded in", () => {
  const hits: FacetHit[] = [
    { value: "Montreal", count: 2306 },
    { value: "Montréal", count: 1208 },
    { value: "Montreal Area", count: 141 },
    { value: "Montréal-Est", count: 13 },
  ];
  assert.deepEqual(selectMatchingHits({ field: "location_city", value: "Montreal" }, hits), [
    { field: "location_city", value: "Montreal" },
    { field: "location_city", value: "Montréal" },
  ]);
});

test("selectMatchingHits: prefix mode's compound match folds too ('Québec - Remote' for a bare 'Quebec')", () => {
  const hits: FacetHit[] = [
    { value: "Quebec", count: 312 },
    { value: "Québec", count: 287 },
    { value: "Québec - Remote", count: 44 },
  ];
  const out = selectMatchingHits({ field: "location_state", value: "Quebec", matchMode: "prefix" }, hits);
  assert.deepEqual(out, [
    { field: "location_state", value: "Quebec" },
    { field: "location_state", value: "Québec" },
    { field: "location_state", value: "Québec - Remote" },
  ]);
});
