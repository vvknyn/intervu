import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  descriptionNeedsFill,
  mergeDescriptionFills,
  planDescriptionFill,
  DESCRIPTION_FILL_MAX_IDS,
  TEASER_MAX_LEN,
} from "../../src/lib/jobs/fill-description";
import type { PublicJob } from "../../src/lib/jobs/types";

function stubHit(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
  return {
    title: "Engineer",
    company: "Acme",
    company_domain: "acme.com",
    location: null,
    location_city: null,
    location_state: null,
    location_country: null,
    work_type: "remote",
    description: null,
    employment_type: "full_time",
    experience_level: "mid",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://example.com/apply",
    source: "test",
    posted_at: null,
    first_seen_at: null,
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "unscored",
    ...overrides,
  };
}

describe("descriptionNeedsFill", () => {
  it("null, empty, and whitespace-only need fill", () => {
    assert.equal(descriptionNeedsFill(null), true);
    assert.equal(descriptionNeedsFill(undefined), true);
    assert.equal(descriptionNeedsFill(""), true);
    assert.equal(descriptionNeedsFill("   "), true);
    assert.equal(descriptionNeedsFill("\n\t"), true);
  });

  it("a real paragraph does not need fill", () => {
    const body = "We are hiring a platform engineer to build reliable systems. ".padEnd(TEASER_MAX_LEN, "x");
    assert.equal(body.length, TEASER_MAX_LEN);
    assert.equal(descriptionNeedsFill(body), false);
  });

  it("short stub needs fill", () => {
    assert.equal(descriptionNeedsFill("We are hiring a platform engineer."), true);
  });

  it("219 chars needs fill", () => {
    assert.equal(descriptionNeedsFill("x".repeat(219)), true);
  });

  it("220 chars without ellipsis does not need fill", () => {
    assert.equal(descriptionNeedsFill("x".repeat(220)), false);
  });

  it("220+ chars ending in ellipsis needs fill", () => {
    assert.equal(descriptionNeedsFill("x".repeat(220) + "..."), true);
    assert.equal(descriptionNeedsFill("x".repeat(220) + "…"), true);
  });
});

describe("planDescriptionFill", () => {
  it("list hits → prefetch those ids (capped)", () => {
    const hits = Array.from({ length: 25 }, (_, i) =>
      stubHit({ id: `job-${i}`, description: null }),
    );
    const plan = planDescriptionFill({}, hits, false);
    assert.equal(plan.mode, "prefetch");
    assert.equal(plan.ids.length, DESCRIPTION_FILL_MAX_IDS);
    assert.deepEqual(plan.ids, hits.slice(0, DESCRIPTION_FILL_MAX_IDS).map((h) => h.id));
  });

  it("id lookup with empty description → await that id", () => {
    const plan = planDescriptionFill(
      { id: "empty-body-1" },
      [stubHit({ id: "empty-body-1", description: "" })],
      false,
    );
    assert.deepEqual(plan, { mode: "await", ids: ["empty-body-1"] });
  });

  it("id lookup with a real body → none (not the empty-body instance)", () => {
    const body = "Own our data pipeline and mentor junior engineers. ".padEnd(TEASER_MAX_LEN, "x");
    assert.equal(body.length, TEASER_MAX_LEN);
    const plan = planDescriptionFill(
      { id: "filled-1" },
      [stubHit({ id: "filled-1", description: body })],
      false,
    );
    assert.deepEqual(plan, { mode: "none", ids: [] });
  });

  it("unavailable or empty hits → none", () => {
    assert.deepEqual(planDescriptionFill({}, [], false), { mode: "none", ids: [] });
    assert.deepEqual(planDescriptionFill({}, [stubHit({ id: "x" })], true), {
      mode: "none",
      ids: [],
    });
  });
});

describe("mergeDescriptionFills", () => {
  it("merges non-empty fills onto matching hits", () => {
    const hits = [
      stubHit({ id: "a", description: null }),
      stubHit({ id: "b", description: "" }),
    ];
    const merged = mergeDescriptionFills(hits, [
      { id: "a", description: "Filled body for A." },
      { id: "b", description: null },
    ]);
    assert.equal(merged[0].description, "Filled body for A.");
    assert.equal(merged[1].description, "");
  });
});
