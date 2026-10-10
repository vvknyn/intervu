import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { jobFromPage, type PageRead } from "../../extension/src/page-reader";
import { resumeFromMe } from "../../extension/src/report";
import { cardSummary, CARD_LINE_LIMIT, type CardInput } from "../../extension/src/card-summary";
import { isKnownJobSite, matchesPattern, sitePattern } from "../../extension/src/job-sites";
import { isSignedInLanding } from "../../extension/src/velai-api";
import { relevanceTerms } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const READ: PageRead = {
    url: "https://boards.greenhouse.io/example/jobs/4821",
    title: "Registered Nurse - ICU | Example Health",
    text: "",
    posting: {
        title: "Registered Nurse - ICU",
        datePosted: "2026-10-04",
        validThrough: "2026-11-15",
        hiringOrganization: { "@type": "Organization", name: "Example Health" },
        jobLocation: { "@type": "Place", address: { addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" } },
        baseSalary: { currency: "CAD", value: { minValue: 41, maxValue: 58, unitText: "HOUR" } },
        description: "<p>Provide care to critically ill adults. IV therapy, Epic charting, BLS and ACLS.</p>",
    },
};
const BARE: PageRead = { url: "https://jobs.lever.co/example/123", title: "Registered Nurse - ICU", text: "Registered Nurse - ICU", posting: { title: "Registered Nurse - ICU" } };

const resume = resumeFromMe({
    signedIn: true,
    resume: { data: null, text: readFileSync(path.join(__dirname, "../../extension/scripts/fixtures/resume.txt"), "utf8"), updatedAt: "2026-10-07T15:00:00Z" },
});

function velai(over: Partial<PublicJob> = {}): PublicJob {
    return {
        ...jobFromPage(READ),
        id: "job-1",
        source: "company_site",
        posted_at: null,
        first_seen_at: ago(48 * HOUR),
        ghost_badge: "clear",
        ghost_checked_at: ago(3 * HOUR),
        last_observed_alive_at: ago(2 * HOUR),
        vacancy_status: "open",
        ...over,
    };
}

function input(over: Partial<CardInput> = {}): CardInput {
    return { pageJob: jobFromPage(READ), velaiJob: null, applyBy: "2026-11-15", signedIn: true, resume, prefs: null, nowMs: NOW, ...over };
}

describe("job sites", () => {
    it("matches Chrome patterns by scheme, host (with *.) and path", () => {
        assert.equal(matchesPattern("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/123", "https://*.myworkdayjobs.com/*"), true);
        assert.equal(matchesPattern("https://myworkdayjobs.com/x", "https://*.myworkdayjobs.com/*"), true);
        assert.equal(matchesPattern("https://evilmyworkdayjobs.com/x", "https://*.myworkdayjobs.com/*"), false);
        assert.equal(matchesPattern("http://boards.greenhouse.io/x", "https://boards.greenhouse.io/*"), false);
        assert.equal(matchesPattern("https://www.linkedin.com/feed/", "https://www.linkedin.com/jobs/*"), false);
        assert.equal(matchesPattern("https://www.linkedin.com/jobs/view/123?trk=x", "https://www.linkedin.com/jobs/*"), true);
    });

    it("knows the listed job sites and nothing else", () => {
        assert.equal(isKnownJobSite("https://jobs.lever.co/example/123"), true);
        assert.equal(isKnownJobSite("https://ca.indeed.com/viewjob?jk=1"), true);
        assert.equal(isKnownJobSite("https://careers.example.org/jobs/1"), false);
        assert.equal(isKnownJobSite("https://www.linkedin.com/in/someone"), false);
    });

    it("asks for one site at a time, https only", () => {
        assert.equal(sitePattern("https://careers.example.org/jobs/1?x=2"), "https://careers.example.org/*");
        assert.equal(sitePattern("http://careers.example.org/jobs/1"), null);
        assert.equal(sitePattern("chrome://extensions"), null);
    });
});

describe("sign-in window", () => {
    it("waits through velai.app's sign-in pages and stops once past them", () => {
        for (const url of ["https://velai.app/login?next=%2Fyours", "https://velai.app/auth/callback?code=1", "https://velai.app/auth/verify-email", "https://velai.app/oauth/authorize", "https://accounts.google.com/o/oauth2"]) {
            assert.equal(isSignedInLanding(url), false, url);
        }
        assert.equal(isSignedInLanding("https://velai.app/yours"), true);
        assert.equal(isSignedInLanding("https://velai.app/jobs?q=nurse"), true);
        assert.equal(isSignedInLanding("https://velai.app.evil.example/yours"), false);
    });
});

describe("cardSummary", () => {
    it("names where every line comes from: Velai's check, then the page's own facts", () => {
        const card = cardSummary(input({ velaiJob: velai() }));
        assert.ok(card.lines.length <= CARD_LINE_LIMIT);
        assert.deepEqual(card.lines.map((l) => l.source), ["Velai, checked today", "the page", "the page", "the page"]);
        assert.match(card.lines[1].text, /^Posted /);
        assert.match(card.lines[2].text, /41/);
        assert.equal(card.lines[3].text, "Apply by Nov 15");
        assert.equal(card.lines[0].tone, "ok");
    });

    it("leaves out what nobody knows instead of guessing", () => {
        const card = cardSummary(input({ pageJob: jobFromPage(BARE), applyBy: null, velaiJob: null }));
        assert.deepEqual(card.lines, []);
        const unchecked = cardSummary(input({ pageJob: jobFromPage(BARE), applyBy: null, velaiJob: velai({ ghost_checked_at: null, salary_min: null, salary_max: null }) }));
        assert.ok(!unchecked.lines.some((l) => l.source.startsWith("Velai, checked")), "no status without a check time");
        assert.deepEqual(unchecked.lines.map((l) => [l.text.startsWith("Posted"), l.source]), [[true, "Velai"]], "Velai's first sighting when the page states no date");
    });

    it("says applications closed when the page's apply-by date has passed", () => {
        const card = cardSummary(input({ applyBy: "2026-10-01" }));
        assert.ok(card.lines.some((l) => l.text === "Applications closed Oct 1" && l.tone === "bad"));
    });

    it("counts the employer's other open roles only when Velai knows there are some", () => {
        const card = cardSummary(input({ pageJob: jobFromPage(BARE), applyBy: null, velaiJob: velai({ company_open_count: 6, ghost_checked_at: null }) }));
        assert.ok(card.lines.some((l) => l.text === "6 open roles at Example Health" && l.source === "Velai"));
        const one = cardSummary(input({ velaiJob: velai({ company_open_count: 1 }) }));
        assert.ok(!one.lines.some((l) => /open roles/.test(l.text)));
    });

    it("gives the fit only against a résumé, and says why otherwise", () => {
        assert.ok(resume, "fixture résumé reads");
        const fit = cardSummary(input({ velaiJob: velai() }));
        assert.ok(fit.fit && fit.account === null);
        assert.equal(cardSummary(input({ signedIn: false, resume: null })).account, "signed-out");
        assert.equal(cardSummary(input({ resume: null })).account, "no-resume");
        assert.equal(cardSummary(input({ signedIn: null, resume: null })).account, "unavailable");
    });

    it("offers I applied only signed in with a known employer, on Velai's job when it has it", () => {
        assert.deepEqual(cardSummary(input({ velaiJob: velai() })).track, {
            title: "Registered Nurse - ICU",
            company: "Example Health",
            applyUrl: READ.url,
            jobId: "job-1",
        });
        assert.equal(cardSummary(input()).track?.jobId, undefined);
        assert.equal(cardSummary(input({ signedIn: false, resume: null })).track, null);
        assert.equal(cardSummary(input({ pageJob: jobFromPage(BARE) })).track, null);
    });
});

describe("relevanceTerms", () => {
    it("splits the fit label's terms into the ones the résumé has and the ones it lacks", () => {
        assert.ok(resume);
        const job = jobFromPage(READ);
        const { matched, missing } = relevanceTerms(resume, job);
        assert.ok(matched.includes("nurse"));
        assert.deepEqual(missing, ["icu"]);
    });
});
