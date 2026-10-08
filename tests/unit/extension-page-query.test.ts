import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_QUERY_CHARS, hostOf, queryFromPage, queryFromSelection } from "../../extension/src/page-query";

const q = (title: string, url = "https://example.com/job/1") => queryFromPage(title, url).q;

test("LinkedIn: role and company, notification count and site name dropped", () => {
    assert.equal(q("(3) Senior Software Engineer | Shopify | LinkedIn", "https://www.linkedin.com/jobs/view/1"), "Senior Software Engineer Shopify");
});

test("Indeed: role kept, place and domain dropped", () => {
    assert.equal(q("Registered Nurse - Toronto, ON - Indeed.com"), "Registered Nurse");
});

test("Greenhouse: lead-in dropped, 'at' splits role from company", () => {
    assert.equal(q("Job Application for Product Designer at Figma"), "Product Designer Figma");
});

test("Lever: company first is fine for search", () => {
    assert.equal(q("Figma - Product Designer"), "Figma Product Designer");
});

test("Ashby: '@' splits role from company", () => {
    assert.equal(q("Account Executive @ Linear"), "Account Executive Linear");
});

test("role: the first part of the search, without what the title pairs it with", () => {
    const board = queryFromPage("Registered Nurse - ICU | Cedarbrook Health - JobBoard.com", "https://jobs.example/1");
    assert.deepEqual([board.role, board.paired, board.q], ["Registered Nurse - ICU", "Cedarbrook Health", "Registered Nurse ICU Cedarbrook Health"]);
    assert.equal(queryFromPage("Senior Accountant - Toronto, ON | Acme Careers", "https://acme.example/jobs/1").role, "Senior Accountant");
    assert.equal(queryFromPage("Job Application for Data Analyst at Acme", "https://boards.greenhouse.io/acme/jobs/1").role, "Data Analyst");
    assert.equal(queryFromPage("Job Application for Data Analyst at Acme", "https://boards.greenhouse.io/acme/jobs/1").paired, "Acme");
});

test("Glassdoor: 'X hiring Y Job in Z' reads role then company", () => {
    assert.equal(q("Acme hiring Physical Therapist Job in Austin, TX | Glassdoor"), "Physical Therapist Acme");
});

test("Hyphenated roles stay whole", () => {
    assert.equal(q("Front-End Developer | Careers"), "Front-End Developer");
});

test("Company careers suffix is trimmed", () => {
    assert.equal(q("Electrician Apprentice - Acme Careers"), "Electrician Apprentice Acme");
});

test("A title with nothing usable gives an empty search, not a guess", () => {
    assert.equal(q("LinkedIn"), "");
    assert.equal(q(""), "");
});

test("Queries are capped", () => {
    assert.ok(q("x".repeat(500)).length <= MAX_QUERY_CHARS);
});

test("site is the host without www", () => {
    assert.equal(queryFromPage("Nurse", "https://www.indeed.com/viewjob?jk=1").site, "indeed.com");
    assert.equal(hostOf("not a url"), null);
});

test("selection: whitespace collapsed and capped", () => {
    assert.deepEqual(queryFromSelection("  Senior\n  Accountant ", "https://jobs.example.org/1"), {
        q: "Senior Accountant",
        role: "Senior Accountant",
        paired: "",
        site: "jobs.example.org",
    });
});
