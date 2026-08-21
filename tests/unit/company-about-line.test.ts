import test from "node:test";
import assert from "node:assert/strict";
import { extractCompanyAboutLine } from "@/lib/companies/about-line";
import type { PublicJob } from "@/lib/jobs/types";

function makeTestJob(id: string, description: string | null, overrides: Partial<PublicJob> = {}): PublicJob {
  return {
    id,
    title: "Software Engineer",
    company: "Acme",
    company_domain: "acme.example",
    location: "Remote",
    location_city: null,
    location_state: null,
    location_country: "US",
    work_type: "remote",
    description,
    employment_type: "full_time",
    experience_level: "mid",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://acme.example/careers/1",
    source: "greenhouse",
    posted_at: "2026-08-01T00:00:00Z",
    first_seen_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    vacancy_status: "open",
    ghost_badge: "clear",
    ...overrides,
  };
}

const MERIDIAN_ABOUT =
  "About Meridian Health. Meridian Health builds remote patient-monitoring software for hospital care teams across twelve state health networks.";
const MERIDIAN_ABOUT_SENTENCE =
  "Meridian Health builds remote patient-monitoring software for hospital care teams across twelve state health networks.";
const EEO_NO_NAME =
  "We are proud to be an equal opportunity employer and prohibit discrimination or harassment of any kind based on race, color, religion, sex, national origin, age, disability, or genetics.";
const APPLY_INSTRUCTIONS =
  "To apply, please submit your application through our online portal and a member of our talent team will follow up within one week regarding next steps.";
const ROLE_BLURB =
  "You will own our on-call rotation, ship backend services in Go, and pair with the platform team on our event pipeline.";

test("repeated About-paragraph beats a repeated EEO/apply-instructions paragraph across 3 distinct postings", () => {
  const jobs = [1, 2, 3].map((n) =>
    makeTestJob(`meridian-${n}`, `${MERIDIAN_ABOUT}\n\n${ROLE_BLURB}\n\n${EEO_NO_NAME}\n\n${APPLY_INSTRUCTIONS}`),
  );
  const result = extractCompanyAboutLine(jobs, "Meridian Health");
  assert.equal(result, MERIDIAN_ABOUT_SENTENCE);
});

test("a short true-but-uninformative opening sentence is rejected for a later, longer descriptive sentence in the same paragraph", () => {
  const SHORT_OPENER = "1Password is growing.";
  const LONGER_SENTENCE =
    "1Password is the password manager millions of people and thousands of businesses trust to store and share sensitive information safely.";
  const paragraph = `${SHORT_OPENER} ${LONGER_SENTENCE}`;
  const jobs = [1, 2].map((n) => makeTestJob(`1p-${n}`, `${paragraph}\n\n${ROLE_BLURB}`));
  const result = extractCompanyAboutLine(jobs, "1Password");
  assert.notEqual(result, SHORT_OPENER);
  assert.equal(result, LONGER_SENTENCE);
});

test("EEO-only boilerplate corpus with no genuine about paragraph returns null", () => {
  const jobs = [1, 2, 3].map((n) =>
    makeTestJob(`vantage-${n}`, `${ROLE_BLURB}\n\n${EEO_NO_NAME}\n\n${APPLY_INSTRUCTIONS}`),
  );
  const result = extractCompanyAboutLine(jobs, "Vantage Freight");
  assert.equal(result, null);
});

test("single-posting company: an About-cue paragraph extracts; the same posting without any cue returns null", () => {
  const withCue =
    "About Cascade Robotics. Cascade Robotics builds autonomous forklifts and warehouse robots that move pallets without human drivers, cutting labor costs for distribution centers.";
  const jobsWithCue = [makeTestJob("cascade-1", `${withCue}\n\n${ROLE_BLURB}`)];
  const resultWithCue = extractCompanyAboutLine(jobsWithCue, "Cascade Robotics");
  assert.notEqual(resultWithCue, null);
  assert.match(resultWithCue as string, /Cascade Robotics/);

  const withoutCue =
    "We need a senior software engineer to build fleet-management APIs for our robotics platform, working closely with hardware and ML teams to ship new autonomy features every quarter.";
  const jobsWithoutCue = [makeTestJob("cascade-2", `${withoutCue}\n\n${ROLE_BLURB}`)];
  const resultWithoutCue = extractCompanyAboutLine(jobsWithoutCue, "Cascade Robotics");
  assert.equal(resultWithoutCue, null);
});

test("a high-scoring candidate paragraph that never mentions the company name returns null (rule 4)", () => {
  const missionNoName =
    "We believe great data tools empower every team to make faster, more confident decisions, and we build software that turns complexity into clarity for everyone who relies on it.";
  const jobs = [1, 2, 3].map((n) => makeTestJob(`solace-${n}`, `${missionNoName}\n\n${ROLE_BLURB}`));
  const result = extractCompanyAboutLine(jobs, "Solace Analytics");
  assert.equal(result, null);
});

test("paragraph splitting handles blank-line, </p>, and doubled <br> block boundaries identically", () => {
  const about =
    "About Bramblewood Foods. Bramblewood Foods bakes small-batch sourdough and ships it directly to home kitchens across the Pacific Northwest, skipping grocery middlemen entirely.";
  const secondPara = "We are hiring a logistics coordinator to manage our cold-chain delivery routes and vendor relationships.";

  const plain = `${about}\n\n${secondPara}`;
  const htmlP = `<p>${about}</p><p>${secondPara}</p>`;
  const htmlBr = `${about}<br><br>${secondPara}`;

  const rPlain = extractCompanyAboutLine([makeTestJob("bw-1", plain)], "Bramblewood Foods");
  const rHtmlP = extractCompanyAboutLine([makeTestJob("bw-2", htmlP)], "Bramblewood Foods");
  const rHtmlBr = extractCompanyAboutLine([makeTestJob("bw-3", htmlBr)], "Bramblewood Foods");

  assert.notEqual(rPlain, null);
  assert.equal(rPlain, rHtmlP);
  assert.equal(rPlain, rHtmlBr);
});

test("pure and deterministic: same inputs produce the same output across repeated calls", () => {
  const jobs = [1, 2, 3].map((n) =>
    makeTestJob(`meridian-${n}`, `${MERIDIAN_ABOUT}\n\n${ROLE_BLURB}\n\n${EEO_NO_NAME}`),
  );
  const first = extractCompanyAboutLine(jobs, "Meridian Health");
  const second = extractCompanyAboutLine(jobs, "Meridian Health");
  assert.equal(first, second);
});

test("perf: a single pass over a ~70-description synthetic corpus completes quickly", () => {
  const filler =
    "This role partners with design and product to ship customer-facing features end to end, from spec through rollout, on a small autonomous team.";
  const jobs: PublicJob[] = [];
  for (let n = 0; n < 70; n++) {
    const desc = [MERIDIAN_ABOUT, ROLE_BLURB, EEO_NO_NAME, APPLY_INSTRUCTIONS, filler, filler, filler]
      .join("\n\n")
      .repeat(3); // ~70 descriptions, each several KB, to approximate a real hit window
    jobs.push(makeTestJob(`perf-${n}`, desc));
  }
  const start = performance.now();
  const result = extractCompanyAboutLine(jobs, "Meridian Health");
  const durationMs = performance.now() - start;
  console.log(`[perf] extractCompanyAboutLine over ${jobs.length} descriptions: ${durationMs.toFixed(3)}ms`);
  assert.equal(result, MERIDIAN_ABOUT_SENTENCE);
  assert.ok(Number.isFinite(durationMs));
});
