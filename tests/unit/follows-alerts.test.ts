import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupFollowAlertsByDomain, jobPostedMs, MAX_FOLLOW_ALERT_DOMAINS } from "@/lib/follows/alerts";
import { listNewRolesForFollows } from "@/lib/follows/list-new-roles";
import type { JobSearchResult, PublicJob } from "@/lib/jobs/types";
import type { FollowedCompany } from "@/lib/follows/types";

const SINCE = "2026-07-20T00:00:00.000Z";
const SINCE_MS = Date.parse(SINCE);

function job(
  id: string,
  domain: string,
  postedTs: number,
  title = "Engineer",
): PublicJob {
  return {
    id,
    title,
    company: domain.split(".")[0],
    company_domain: domain,
    location: "Remote",
    location_city: null,
    location_state: null,
    location_country: null,
    work_type: "remote",
    description: null,
    employment_type: "full_time",
    experience_level: "senior",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://example.com/apply",
    source: "test",
    posted_at: new Date(postedTs).toISOString(),
    first_seen_at: new Date(postedTs).toISOString(),
    posted_ts: postedTs,
    updated_at: new Date(postedTs).toISOString(),
    vacancy_status: "open",
    ghost_badge: "clear",
  };
}

const rad: FollowedCompany = {
  domain: "rad-ai.com",
  slug: "rad-ai",
  displayName: "Rad AI",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const vectral: FollowedCompany = {
  domain: "vectral.io",
  slug: "vectral",
  displayName: "Vectral",
  createdAt: "2026-07-02T00:00:00.000Z",
};

describe("jobPostedMs", () => {
  it("prefers posted_ts when present", () => {
    assert.equal(jobPostedMs(job("1", "a.com", SINCE_MS + 1000)), SINCE_MS + 1000);
  });
});

describe("groupFollowAlertsByDomain", () => {
  it("groups followed domains and drops jobs at or before the cursor", () => {
    const groups = groupFollowAlertsByDomain(
      [
        job("new-rad", "rad-ai.com", SINCE_MS + 86_400_000, "Senior Platform Engineer"),
        job("old-rad", "rad-ai.com", SINCE_MS - 86_400_000, "Legacy Role"),
        job("new-vectral", "vectral.io", SINCE_MS + 172_800_000, "Staff Backend Engineer"),
        job("other", "other.com", SINCE_MS + 86_400_000, "Outside follow list"),
      ],
      [rad, vectral],
      SINCE,
    );

    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.domain, "vectral.io");
    assert.equal(groups[0]?.displayName, "Vectral");
    assert.deepEqual(groups[0]?.jobs.map((j) => j.id), ["new-vectral"]);

    const radGroup = groups.find((g) => g.domain === "rad-ai.com");
    assert.ok(radGroup);
    assert.deepEqual(radGroup.jobs.map((j) => j.id), ["new-rad"]);
  });

  it("sorts jobs within a domain by newest first", () => {
    const groups = groupFollowAlertsByDomain(
      [
        job("older", "rad-ai.com", SINCE_MS + 86_400_000),
        job("newer", "rad-ai.com", SINCE_MS + 259_200_000),
      ],
      [rad],
      SINCE,
    );

    assert.deepEqual(groups[0]?.jobs.map((j) => j.id), ["newer", "older"]);
  });

  it("returns empty for invalid sinceIso", () => {
    assert.deepEqual(groupFollowAlertsByDomain([job("1", "rad-ai.com", SINCE_MS + 1)], [rad], "not-a-date"), []);
  });
});

describe("listNewRolesForFollows", () => {
  it("fans out companyDomain searches and filters client-side by cursor", async () => {
    const calls: string[] = [];
    const search = async (params: { companyDomain?: string }): Promise<JobSearchResult> => {
      calls.push(params.companyDomain ?? "");
      if (params.companyDomain === "rad-ai.com") {
        return {
          hits: [
            job("rad-new", "rad-ai.com", SINCE_MS + 1),
            job("rad-old", "rad-ai.com", SINCE_MS - 1),
          ],
          total: 2,
          backend: "meilisearch",
          configured: true,
        };
      }
      return { hits: [], total: 0, backend: "meilisearch", configured: true };
    };

    const groups = await listNewRolesForFollows(SINCE, [rad, vectral], search);
    assert.deepEqual(calls, ["rad-ai.com", "vectral.io"]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]?.jobs.map((j) => j.id), ["rad-new"]);
  });

  it("caps domains checked", async () => {
    let callCount = 0;
    const follows = Array.from({ length: MAX_FOLLOW_ALERT_DOMAINS + 5 }, (_, i) => ({
      domain: `co${i}.com`,
      slug: `co${i}`,
      displayName: `Co ${i}`,
      createdAt: SINCE,
    }));

    await listNewRolesForFollows(
      SINCE,
      follows,
      async () => {
        callCount++;
        return { hits: [], total: 0, backend: "meilisearch", configured: true };
      },
    );

    assert.equal(callCount, MAX_FOLLOW_ALERT_DOMAINS);
  });
});
