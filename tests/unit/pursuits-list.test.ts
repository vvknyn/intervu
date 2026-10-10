import { test } from "node:test";
import assert from "node:assert/strict";
import { toApplicationSummary } from "../../src/lib/pursuits/list";
import type { Pursuit } from "../../src/lib/pursuits/types";

function makePursuit(overrides: Partial<Pursuit> = {}): Pursuit {
    return {
        id: "p1",
        company_name: "Acme",
        position: "Engineer",
        status: "interested",
        user_id: "u1",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
        ...overrides,
    };
}

test("toApplicationSummary: resume_on_file is true and latest_resume_label is the newest by saved_at when multiple versions exist", () => {
    const older = { content: "c1", label: "v1", saved_at: "2026-07-01T00:00:00.000Z" };
    const newer = { content: "c2", label: "v2", saved_at: "2026-07-10T00:00:00.000Z" };
    const p = makePursuit({ resume_versions: [older, newer] });
    const summary = toApplicationSummary(p);
    assert.equal(summary.resume_on_file, true);
    assert.equal(summary.latest_resume_label, "v2");
});

test("toApplicationSummary: resume_on_file is false and latest_resume_label is null when no versions exist", () => {
    const p = makePursuit({ resume_versions: [] });
    const summary = toApplicationSummary(p);
    assert.equal(summary.resume_on_file, false);
    assert.equal(summary.latest_resume_label, null);
});

test("toApplicationSummary: resume_on_file is false and latest_resume_label is null when resume_versions is absent", () => {
    const p = makePursuit();
    const summary = toApplicationSummary(p);
    assert.equal(summary.resume_on_file, false);
    assert.equal(summary.latest_resume_label, null);
});

test("toApplicationSummary: job_id passes through null when absent", () => {
    const p = makePursuit();
    const summary = toApplicationSummary(p);
    assert.equal(summary.job_id, null);
});

test("toApplicationSummary: job_id passes through the real value when present", () => {
    const p = makePursuit({ job_id: "job-123" });
    const summary = toApplicationSummary(p);
    assert.equal(summary.job_id, "job-123");
});

test("toApplicationSummary: company passes through null when company_name is falsy (empty string)", () => {
    const p = makePursuit({ company_name: "" });
    const summary = toApplicationSummary(p);
    assert.equal(summary.company, null);
});

test("toApplicationSummary: company is the real value when present", () => {
    const p = makePursuit({ company_name: "Acme" });
    const summary = toApplicationSummary(p);
    assert.equal(summary.company, "Acme");
});

test("toApplicationSummary: title/status/updated_at/id map straight through from position/status/updated_at/id", () => {
    const p = makePursuit({
        id: "p9",
        position: "Staff Engineer",
        status: "interviewing",
        updated_at: "2026-07-20T00:00:00.000Z",
    });
    const summary = toApplicationSummary(p);
    assert.equal(summary.id, "p9");
    assert.equal(summary.title, "Staff Engineer");
    assert.equal(summary.status, "interviewing");
    assert.equal(summary.updated_at, "2026-07-20T00:00:00.000Z");
});

test("toApplicationSummary: the copy taken when it was marked Applied counts as a résumé on file, labelled as the site labels it", () => {
    const p = makePursuit({ status: "applied", applied_resume: { saved_at: "2026-10-10T00:00:00.000Z" } });
    const summary = toApplicationSummary(p);
    assert.equal(summary.resume_on_file, true);
    assert.equal(summary.latest_resume_label, "Your résumé");
});

test("toApplicationSummary: a version filed for the role names the role's résumé over the applied copy", () => {
    const p = makePursuit({
        status: "applied",
        applied_resume: { saved_at: "2026-10-10T00:00:00.000Z" },
        resume_versions: [{ content: "c", label: "Tailored for Acme", saved_at: "2026-10-09T00:00:00.000Z" }],
    });
    assert.equal(toApplicationSummary(p).latest_resume_label, "Tailored for Acme");
});

test("toApplicationSummary: carries the dates, link and note the tracker shows", () => {
    const p = makePursuit({
        status: "interviewing",
        applied_at: "2026-10-01T00:00:00.000Z",
        interview_date: "2026-10-15",
        job_url: "https://acme.com/old",
        job_snapshot: { title: "Engineer", company: "Acme", location: null, apply_url: "https://acme.com/apply" },
        note: "  Recruiter is Sam  ",
    });
    const summary = toApplicationSummary(p);
    assert.equal(summary.applied_at, "2026-10-01T00:00:00.000Z");
    assert.equal(summary.interview_date, "2026-10-15");
    assert.equal(summary.apply_url, "https://acme.com/apply");
    assert.equal(summary.note, "Recruiter is Sam");
});

test("toApplicationSummary: absent dates, link and note are null, never invented", () => {
    const summary = toApplicationSummary(makePursuit());
    assert.equal(summary.applied_at, null);
    assert.equal(summary.interview_date, null);
    assert.equal(summary.apply_url, null);
    assert.equal(summary.note, null);
});
