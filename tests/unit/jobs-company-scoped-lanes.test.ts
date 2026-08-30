import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyScopedSearchLanes,
  shouldRunCompanyScopedLanes,
  shouldSkipSortIntegrityForCompanyLanes,
} from "../../src/lib/jobs/company-scoped-lanes";
import type { JobSearchParams, PlaceClause } from "../../src/lib/jobs/types";

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
