import { test } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_ROLES_ATTRIBUTES, publicRoles } from "../../src/lib/companies/company-roles-query";
import { withoutNonPlaceLocation } from "../../src/lib/jobs/non-place-location";
import { decodeText, locationText } from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

const job = (o: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob =>
  ({ title: "Engineer", company: "Acme", company_domain: "acme.com", location: null, location_city: null, location_state: null,
    location_country: null, work_type: "unknown", description: "long body", ...o }) as PublicJob;

/** What a directory read returns: only the attributes the Meili query asks for. */
const pick = (j: PublicJob): PublicJob => {
  const kept: Record<string, unknown> = {};
  for (const k of PUBLIC_ROLES_ATTRIBUTES) kept[k] = j[k];
  return kept as unknown as PublicJob;
};
const keys = (jobs: PublicJob[]) => jobs.map((j) => `${decodeText(j.title).trim().toLowerCase()}|${locationText(j).trim().toLowerCase()}`);

const FIXTURES: PublicJob[] = [
  job({ id: "1", title: "Remote Dev", work_type: "remote" }),
  job({ id: "2", title: "Remote Dev", work_type: "onsite" }),
  job({ id: "3", title: "City Dev", location_city: "Austin" }),
  job({ id: "4", title: "City Dev", location_city: "Austin", location_state: "TX", location_country: "US" }),
  job({ id: "5", title: "Support", location: "Spanish & English", location_city: "Spanish", location_country: "Canada" }),
  job({ id: "6", title: "Support" }),
  job({ id: "7", title: "Internal Transfer Applicants" }),
  job({ id: "8", title: "Sales", location: "Berlin, Germany" }),
];

test("PUBLIC_ROLES_ATTRIBUTES covers every field publicRoles reads: picked rows give the same keys and count as full rows", () => {
  const full = publicRoles(FIXTURES);
  const picked = publicRoles(FIXTURES.map(pick));
  assert.deepEqual(keys(picked), keys(full));
  assert.equal(picked.length, full.length);
  assert.ok(full.length < FIXTURES.length, "fixtures must exercise the filters");
});

test("work_type is load-bearing: without it a remote and an unlisted posting of one title would wrongly collapse", () => {
  const without = FIXTURES.map((j) => ({ ...pick(j), work_type: null }) as unknown as PublicJob);
  assert.notEqual(publicRoles(without).length, publicRoles(FIXTURES).length);
});

test("same title whose locations differ only by a non-place value collapse to one, pre-cleaned or not", () => {
  const a = job({ id: "a", title: "Support" });
  const b = job({ id: "b", title: "Support", location: "Bilingual", location_city: "Bilingual", location_country: "Canada" });
  assert.equal(publicRoles([a, b]).length, 1);
  assert.equal(publicRoles([a, b].map(withoutNonPlaceLocation)).length, 1);
});
