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

/*
 * Fixtures below are minimal excerpts derived from the two real-index
 * description shapes that motivated this fix (ground-truth audit,
 * 2026-08-21) — 1Password's zero-newline markdown-marker style and
 * Greystar's glued-ALL-CAPS-heading style — plus a blank-line-style
 * regression exercising the new heading-adjacency scoring bonus. Not the
 * real descriptions themselves (those aren't committed): short, hand-built
 * excerpts under ~600 chars that reproduce the SHAPE, not the content.
 */

test("zero-newline, markdown-marker-style description (1Password shape) yields a clean sentence instead of null — the bug this PR fixes", () => {
  // Single unbroken block: no blank lines anywhere, `**bold**`/`*italic*`
  // markers used as de-facto headings mid-prose. Before this fix,
  // paragraphsOf's `\n{2,}` split saw one block and produced zero
  // candidates for every company shaped like this.
  const raw =
    "**Acme Robotics is growing.** We've surpassed $50M in bookings and keep shipping new features every quarter for our logistics customers. * **About Acme Robotics** *At Acme Robotics, we help enterprises automate warehouse operations.*";
  const jobs = [1, 2].map((n) => makeTestJob(`mmstyle-${n}`, raw));
  const result = extractCompanyAboutLine(jobs, "Acme Robotics");
  assert.notEqual(result, null);
  assert.doesNotMatch(result as string, /\*\*/);
  assert.doesNotMatch(result as string, /\*/);
});

test("glued ALL-CAPS heading description (Greystar shape) never leaks the heading into the output, and extracts the clean body sentence", () => {
  // No separator at all between the ALL-CAPS heading and its Titlecase
  // body — the exact shape the module doc warns about: formatDescription
  // must separate "ABOUT ACME LOGISTICS" from "Acme Logistics is..." before
  // this module ever sees it as a candidate paragraph.
  const body =
    "Acme Logistics is a leading warehouse-automation platform helping mid-market retailers cut fulfillment costs across North America.";
  const raw = `ABOUT ACME LOGISTICS${body}`;
  const jobs = [1, 2].map((n) => makeTestJob(`gluedcaps-${n}`, raw));
  const result = extractCompanyAboutLine(jobs, "Acme Logistics");
  assert.equal(result, body);
  assert.doesNotMatch(result as string, /^ABOUT ACME LOGISTICS/);
});

test("an 'About {Company}' heading block (blank-line separated) attaches its scoring bonus to the paragraph that follows it — single-posting company with no textual opening cue on the body itself", () => {
  const heading = "ABOUT ACME FREIGHT";
  const body =
    "Acme Freight operates a nationwide fleet of electric delivery trucks that helps retailers move last-mile packages faster while cutting emissions across every major metro area.";
  const withHeading = [makeTestJob("heading-bonus-1", `${heading}\n\n${body}\n\n${ROLE_BLURB}`)];
  const result = extractCompanyAboutLine(withHeading, "Acme Freight");
  assert.equal(result, body);

  // Control: the identical body paragraph with no heading above it. The
  // body itself starts with "Acme Freight operates" — not an
  // openingCueRegexes match (only is/builds/provides/makes/helps/offers) —
  // so without the heading-adjacency bonus this single-posting company has
  // no qualifying candidate at all.
  const withoutHeading = [makeTestJob("heading-bonus-2", `${body}\n\n${ROLE_BLURB}`)];
  const resultWithoutHeading = extractCompanyAboutLine(withoutHeading, "Acme Freight");
  assert.equal(resultWithoutHeading, null);
});

/*
 * Fixtures below cover the display-name-vs-prose-name gap (ground-truth
 * audit, 2026-08-21): prod's H1 is `displayCompanyName`'s output — often a
 * legal/long form ("Greystar Management Services") — while the company's
 * own posting prose uses the stem ("Greystar"). Every name check in this
 * module now tries the full display name AND each shorter token-prefix, not
 * just the full name.
 */

test("display-name-vs-prose-name gap (Greystar shape): the PROD display name 'Greystar Management Services' still extracts, even though the posting prose only ever says 'Greystar Management'", () => {
  const heading = "ABOUT GREYSTAR MANAGEMENT SERVICES";
  const body =
    "Greystar Management is a leading, fully integrated real estate platform offering property management and investment services across North America.";
  const jobs = [1, 2].map((n) => makeTestJob(`gms-${n}`, `${heading}\n\n${body}\n\n${ROLE_BLURB}`));
  const result = extractCompanyAboutLine(jobs, "Greystar Management Services");
  assert.equal(result, body);
});

test("single-token name-form guard: a lowercase mid-sentence collision on a common-word company stem does NOT satisfy rule 4", () => {
  // "United" is the risky bare stem of "United Something Logistics" — a
  // common capitalized English word. The paragraph below repeats across 2
  // postings (would otherwise win outright) and contains "united" only in
  // incidental lowercase running prose, never Title-cased or ALL-CAPS as
  // the company's own name would actually render.
  const body =
    "Our teams operate with a united approach to logistics across every region we serve, and we take pride in reliable, on-time delivery for every customer we work with.";
  const jobs = [1, 2].map((n) => makeTestJob(`unitedco-${n}`, `${body}\n\n${ROLE_BLURB}`));
  const result = extractCompanyAboutLine(jobs, "United Something Logistics");
  assert.equal(result, null);
});

test("a legal-suffix display name ('Acme Inc' style) extracts using the stem the company's own prose actually uses — class-wide, not Greystar-specific", () => {
  const body =
    "Acme builds route-optimization software that helps regional carriers cut fuel costs and delivery times across the Midwest.";
  const jobs = [1, 2].map((n) => makeTestJob(`acmeinc-${n}`, `${body}\n\n${ROLE_BLURB}`));
  const result = extractCompanyAboutLine(jobs, "Acme Inc");
  assert.equal(result, body);
});

test("title-case glued section labels (Stripe shape) are stripped from the hero about line", () => {
  const polluted =
    "Who we are About Stripe Stripe is a financial infrastructure platform for businesses of every size, from startups to Fortune 500 companies.";
  const clean =
    "Stripe is a financial infrastructure platform for businesses of every size, from startups to Fortune 500 companies.";
  const jobs = [1, 2].map((n) => makeTestJob(`stripe-${n}`, `${polluted}\n\n${ROLE_BLURB}`));
  const result = extractCompanyAboutLine(jobs, "Stripe");
  assert.equal(result, clean);
});

test("already-clean about text is returned unchanged after section-label stripping", () => {
  const clean =
    "Stripe is a financial infrastructure platform for businesses of every size, from startups to Fortune 500 companies.";
  const jobs = [1, 2].map((n) => makeTestJob(`stripe-clean-${n}`, `${clean}\n\n${ROLE_BLURB}`));
  const result = extractCompanyAboutLine(jobs, "Stripe");
  assert.equal(result, clean);
});

test("About the Team: section label (Supabase shape) is stripped from the hero about line", () => {
  const polluted =
    "About the Team: Supabase was born-remote and open-source-first, building developer tools that make Postgres accessible to every team.";
  const clean =
    "Supabase was born-remote and open-source-first, building developer tools that make Postgres accessible to every team.";
  const jobs = [1, 2].map((n) => makeTestJob(`supabase-${n}`, `${polluted}\n\n${ROLE_BLURB}\n\n${EEO_NO_NAME}`));
  const result = extractCompanyAboutLine(jobs, "Supabase");
  assert.equal(result, clean);
});

test("EEO boilerplate naming the company (Rivian shape) cannot win when it is the only repeating candidate", () => {
  const RIVIAN_EEO =
    "Rivian is an equal opportunity employer and complies with all applicable federal, state, and local fair employment practices laws.";
  const jobs = [1, 2, 3].map((n) => makeTestJob(`rivian-${n}`, `${ROLE_BLURB}\n\n${RIVIAN_EEO}`));
  const result = extractCompanyAboutLine(jobs, "Rivian");
  assert.equal(result, null);
});

test("EEO boilerplate naming the company (Twitch shape) cannot win when it is the only repeating candidate", () => {
  const TWITCH_EEO =
    "Twitch is an equal opportunity employer and does not discriminate on the basis of protected veteran status, disability, or other legally protected status.";
  const jobs = [1, 2, 3].map((n) => makeTestJob(`twitch-${n}`, `${ROLE_BLURB}\n\n${TWITCH_EEO}`));
  const result = extractCompanyAboutLine(jobs, "Twitch");
  assert.equal(result, null);
});

test("mid-sentence our mission prose (Vanta shape) is not stripped as a section label", () => {
  const mission =
    "At Vanta, our mission is to help businesses earn and prove trust by automating security and compliance workflows for companies of every size.";
  const jobs = [1, 2].map((n) => makeTestJob(`vanta-${n}`, `${mission}\n\n${ROLE_BLURB}`));
  const result = extractCompanyAboutLine(jobs, "Vanta");
  assert.equal(result, mission);
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
