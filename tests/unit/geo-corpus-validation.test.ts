import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCorpusValueChecker,
  selectMatchingHits,
  type FacetHit,
  type FacetSearchFetcher,
} from "../../src/lib/geo/corpus-values";
import type { PlaceCandidate } from "../../src/lib/geo/resolve-place";

test("selectMatchingHits: exact mode keeps only the literal case-insensitive match, in the CORPUS's own casing", () => {
  const hits: FacetHit[] = [{ value: "MISSISSAUGA", count: 1306 }, { value: "Mississauga Heights", count: 4 }];
  const candidate: PlaceCandidate = { field: "location_city", value: "Mississauga" };
  assert.deepEqual(selectMatchingHits(candidate, hits), [{ field: "location_city", value: "MISSISSAUGA" }]);
});

test("selectMatchingHits: no matching hit means no filter — never invents one", () => {
  const hits: FacetHit[] = [{ value: "Toronto", count: 500 }];
  const candidate: PlaceCandidate = { field: "location_city", value: "Nowhereville" };
  assert.deepEqual(selectMatchingHits(candidate, hits), []);
});

test("selectMatchingHits: prefix mode also keeps every real compound value ('Canada - Remote', 'Canada - Toronto')", () => {
  const hits: FacetHit[] = [
    { value: "Canada", count: 34130 },
    { value: "Canada - Remote", count: 175 },
    { value: "Canada - Toronto", count: 55 },
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
  const result = await checker([{ field: "location_city", value: "Nowhereville" }]);
  assert.deepEqual(result, []);
});

test("createCorpusValueChecker: validates a whole expansion set, keeping only what the corpus actually has", async () => {
  const { fetcher } = stubFetcher({
    "location_city:toronto": [{ value: "Toronto", count: 5183 }],
    "location_city:markham": [{ value: "Markham", count: 349 }],
    "location_city:brampton": [], // resolver proposed it; corpus has nothing tagged this way
  });
  const checker = createCorpusValueChecker(fetcher);
  const result = await checker([
    { field: "location_city", value: "Toronto" },
    { field: "location_city", value: "Markham" },
    { field: "location_city", value: "Brampton" },
  ]);
  assert.deepEqual(
    result.map((f) => f.value).sort(),
    ["Markham", "Toronto"],
  );
});

test("createCorpusValueChecker: repeat candidates hit the cache — one network call per unique (field, value)", async () => {
  const { fetcher, calls } = stubFetcher({ "location_city:toronto": [{ value: "Toronto", count: 5183 }] });
  const checker = createCorpusValueChecker(fetcher);
  await checker([{ field: "location_city", value: "Toronto" }]);
  await checker([{ field: "location_city", value: "Toronto" }]);
  await checker([{ field: "location_city", value: "toronto" }]); // different casing, same corpus query
  assert.equal(calls.length, 1, `expected exactly one fetch, got ${JSON.stringify(calls)}`);
});

test("createCorpusValueChecker: a fetch failure (null) fails the candidate open and is not cached as a false negative", async () => {
  let callCount = 0;
  const fetcher: FacetSearchFetcher = async () => {
    callCount += 1;
    return callCount === 1 ? null : [{ value: "Toronto", count: 5183 }];
  };
  const checker = createCorpusValueChecker(fetcher);
  const first = await checker([{ field: "location_city", value: "Toronto" }]);
  assert.deepEqual(first, [], "first call: fetch failed, candidate resolves to nothing");
  const second = await checker([{ field: "location_city", value: "Toronto" }]);
  assert.deepEqual(second, [{ field: "location_city", value: "Toronto" }], "retried, not stuck on a cached failure");
});

test("createCorpusValueChecker: duplicate resulting filters are deduped — the exact and prefix candidates resolveCountry emits for the same name both match the plain 'Canada' hit", async () => {
  const { fetcher } = stubFetcher({
    "location_country:canada": [
      { value: "Canada", count: 34130 },
      { value: "Canada - Remote", count: 175 },
    ],
  });
  const checker = createCorpusValueChecker(fetcher);
  const result = await checker([
    { field: "location_country", value: "Canada" },
    { field: "location_country", value: "Canada", matchMode: "prefix" },
  ]);
  assert.deepEqual(
    result.map((f) => f.value).sort(),
    ["Canada", "Canada - Remote"],
  );
});
