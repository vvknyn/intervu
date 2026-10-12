import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleCompanyLanePool,
  buildCompanyScopedSearchLanes,
  companyLaneTailWindow,
  shouldRunCompanyScopedLanes,
  shouldSkipSortIntegrityForCompanyLanes,
  type CompanyLaneFetch,
} from "../../src/lib/jobs/company-scoped-lanes";
import type { JobSearchParams, PlaceClause, PublicJob } from "../../src/lib/jobs/types";

const remoteCanada: PlaceClause = {
  any: [{ field: "location_country", value: "Canada" }],
  workTypes: ["remote"],
};

test("shouldRunCompanyScopedLanes: false for role queries and bare employer", () => {
  assert.equal(shouldRunCompanyScopedLanes(false, { q: "product manager" }), false);
  assert.equal(shouldRunCompanyScopedLanes(true, { q: "tesla" }), false);
});

test("shouldRunCompanyScopedLanes: true when companyScoped and place or work_type set", () => {
  assert.equal(
    shouldRunCompanyScopedLanes(true, { q: "tesla", places: [remoteCanada] }),
    true,
  );
  assert.equal(
    shouldRunCompanyScopedLanes(true, { q: "tesla", facets: { work_type: ["remote"] } }),
    true,
  );
});

test("buildCompanyScopedSearchLanes: four distinct lanes when all constraints present", () => {
  const p: JobSearchParams = {
    q: "tesla",
    companyDomain: "tesla.com",
    places: [remoteCanada],
    facets: { work_type: ["remote"] },
  };
  const lanes = buildCompanyScopedSearchLanes(p);
  assert.equal(lanes.length, 4);
  assert.deepEqual(lanes[0]?.facets?.work_type, ["remote"]);
  assert.ok(lanes[0]?.places?.[0]?.workTypes?.includes("remote"));
  assert.equal(lanes[1]?.facets?.work_type, undefined);
  assert.equal(lanes[1]?.places?.[0]?.workTypes, undefined);
  assert.ok(lanes[1]?.places?.length);
  assert.equal(lanes[2]?.places, undefined);
  assert.deepEqual(lanes[2]?.facets?.work_type, ["remote"]);
  assert.equal(lanes[3]?.places, undefined);
  assert.equal(lanes[3]?.facets?.work_type, undefined);
});

test("buildCompanyScopedSearchLanes: skips identical lanes", () => {
  const p: JobSearchParams = {
    q: "microsoft",
    companyDomain: "microsoft.com",
    places: [{ any: [{ field: "location_country", value: "Canada" }] }],
  };
  const lanes = buildCompanyScopedSearchLanes(p);
  assert.equal(lanes.length, 2);
  assert.ok(lanes[0]?.places?.length);
  assert.equal(lanes[1]?.places, undefined);
});

test("shouldSkipSortIntegrityForCompanyLanes: true whenever company lanes run", () => {
  const p: JobSearchParams = {
    q: "tesla",
    places: [{ any: [{ field: "location_country", value: "Canada" }] }],
  };
  assert.equal(shouldSkipSortIntegrityForCompanyLanes(true, p), true);
  assert.equal(shouldSkipSortIntegrityForCompanyLanes(false, p), false);
  assert.equal(shouldSkipSortIntegrityForCompanyLanes(true, { q: "tesla" }), false);
});

test("buildCompanyScopedSearchLanes: work_type facet only yields two lanes", () => {
  const p: JobSearchParams = {
    q: "stripe",
    companyDomain: "stripe.com",
    facets: { work_type: ["remote"] },
  };
  const lanes = buildCompanyScopedSearchLanes(p);
  assert.equal(lanes.length, 2);
  assert.deepEqual(lanes[0]?.facets?.work_type, ["remote"]);
  assert.equal(lanes[1]?.facets?.work_type, undefined);
});

const inCanada: PlaceClause = { any: [{ field: "location_country", value: "Canada" }] };
const rows = (...ids: string[]) => ids.map((id) => ({ id }) as PublicJob);
const ids = (hits: PublicJob[]) => hits.map((h) => h.id);
/** Lanes as `buildCompanyScopedSearchLanes` orders them, each paired with what its fetch returned. */
const fetched = (p: JobSearchParams, perLane: { hits: string[]; total?: number }[]): CompanyLaneFetch[] =>
  buildCompanyScopedSearchLanes(p).map((params, i) => ({
    params,
    hits: rows(...perLane[i].hits),
    total: perLane[i].total ?? perLane[i].hits.length,
  }));
const byIdDescending = (hits: PublicJob[]) => [...hits].sort((a, b) => b.id.localeCompare(a.id));

test("assembleCompanyLanePool: rows in the requested place lead, each segment ranked on its own", () => {
  const lanes = fetched(
    { q: "globex", companyDomain: "globex.com", places: [inCanada] },
    [{ hits: ["a", "b"] }, { hits: ["a", "b", "c", "d"] }],
  );
  const pool = assembleCompanyLanePool(lanes, byIdDescending);
  // A global rerank would put "d" first; the place segment must stay ahead of it.
  assert.deepEqual(ids(pool.hits), ["b", "a", "d", "c"]);
  assert.equal(pool.inPlace, 2);
  assert.equal(pool.total, 4);
  assert.equal(pool.tail, undefined, "every lane held all of its matches, so there is nothing to page on to");
});

test("assembleCompanyLanePool: a place with no rows still reports the employer's rows from elsewhere, labelled", () => {
  const lanes = fetched(
    { q: "globex", companyDomain: "globex.com", places: [inCanada] },
    [{ hits: [] }, { hits: ["x", "y", "z"] }],
  );
  const pool = assembleCompanyLanePool(lanes, (h) => h);
  assert.deepEqual(ids(pool.hits), ["x", "y", "z"]);
  assert.equal(pool.inPlace, 0);
  assert.equal(pool.total, 3);
});

test("assembleCompanyLanePool: past one fetch the total is the lane's real count and the lane that serves the rest is named", () => {
  const p: JobSearchParams = { q: "initech", companyDomain: "initech.com", places: [inCanada] };
  const lanes = fetched(p, [{ hits: ["a", "b"] }, { hits: ["a", "b", "c"], total: 9049 }]);
  const pool = assembleCompanyLanePool(lanes, (h) => h);
  assert.equal(pool.total, 9049, "not the 3 rows that were fetched");
  assert.equal(pool.inPlace, 2);
  assert.deepEqual(pool.tail, lanes[1].params);
});

test("assembleCompanyLanePool: a place that alone overflows one fetch keeps the list in the place", () => {
  const p: JobSearchParams = { q: "umbrella", companyDomain: "umbrella.com", places: [inCanada] };
  const lanes = fetched(p, [
    { hits: ["p1", "p2"], total: 340 },
    { hits: ["p1", "p2", "e1"], total: 1000 },
  ]);
  const pool = assembleCompanyLanePool(lanes, (h) => h);
  assert.deepEqual(ids(pool.hits), ["p1", "p2"], "rows from elsewhere wait until the place has none left");
  assert.equal(pool.total, 340);
  assert.equal(pool.inPlace, 340);
  assert.deepEqual(pool.tail, lanes[0].params);
});

test("assembleCompanyLanePool: no place asked for means no in-place claim, one ranking over the union", () => {
  const p: JobSearchParams = { q: "acme", companyDomain: "acme.com", facets: { work_type: ["remote"] } };
  const lanes = fetched(p, [{ hits: ["a", "b"] }, { hits: ["a", "b", "c"] }]);
  const pool = assembleCompanyLanePool(lanes, byIdDescending);
  assert.deepEqual(ids(pool.hits), ["c", "b", "a"]);
  assert.equal(pool.inPlace, undefined);
  assert.equal(pool.total, 3);
});

test("assembleCompanyLanePool: nothing matching reports zero, not a made-up count", () => {
  const lanes = fetched({ q: "acme", companyDomain: "acme.com", places: [inCanada] }, [{ hits: [] }, { hits: [] }]);
  const pool = assembleCompanyLanePool(lanes, (h) => h);
  assert.deepEqual(pool, { hits: [], inPlace: 0, total: 0 });
});

test("companyLaneTailWindow: asks the tail lane only for the rows the pool cannot supply", () => {
  assert.equal(companyLaneTailWindow(100, 0, 40), null, "first page is inside the pool");
  assert.equal(companyLaneTailWindow(100, 60, 40), null, "a page ending exactly at the pool's edge");
  assert.deepEqual(companyLaneTailWindow(100, 80, 40), { offset: 0, limit: 20 }, "a page straddling the edge");
  assert.deepEqual(companyLaneTailWindow(100, 100, 40), { offset: 0, limit: 40 });
  assert.deepEqual(companyLaneTailWindow(100, 120, 40), { offset: 20, limit: 40 }, "past the edge: skip what earlier pages used");
  assert.deepEqual(companyLaneTailWindow(30, 0, 40), { offset: 0, limit: 10 }, "a pool smaller than one page");
  assert.deepEqual(companyLaneTailWindow(0, 0, 40), { offset: 0, limit: 40 });
});
