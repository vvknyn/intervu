import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Marking a role Applied copies the résumé on file onto it
 * (src/lib/pursuits/resume-on-apply.ts). The journey audit (2026-09-30)
 * found "Resume used" could only ever be filled by the MCP tools.
 */

class FakeLocalStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
}
const fakeLocalStorage = new FakeLocalStorage();
(globalThis as unknown as { localStorage: FakeLocalStorage }).localStorage = fakeLocalStorage;

import {
    APPLIED_RESUME_LABEL,
    appliedResumeFor,
    attachesResumeOnApply,
    resumeTextOnFile,
    withoutAppliedResumeText,
} from "../../src/lib/pursuits/resume-on-apply";
import {
    addManualGuestPursuit,
    clearGuestPursuits,
    listGuestPursuits,
    removeGuestAppliedResume,
    removeGuestAppliedResumes,
    updateGuestPursuit,
} from "../../src/lib/pursuits/guest-store";
import { LOCAL_AI_RESUME_KEY } from "../../src/lib/local-ai/resume-storage";
import { resumeDataToPlainText } from "../../src/lib/resume/to-plain-text";
import { resumeDataFromPlainText } from "../../src/lib/resume/structure-resume-text";
import { guestAppliedResumeSchema, updateApplicationSchema, validate } from "../../src/lib/validation";
import type { Pursuit, PursuitStage } from "../../src/lib/pursuits/types";
import type { ResumeData, ResumeSection } from "../../src/types/resume";

const NOW = "2026-10-03T16:00:00.000Z";
const FIXTURES = join(__dirname, "../fixtures");
const SAMPLE_TEXT = readFileSync(join(FIXTURES, "sample-resume.txt"), "utf8");
const SAMPLE_DATA: ResumeData = resumeDataFromPlainText(SAMPLE_TEXT);

const role = (status: PursuitStage, extra: Partial<Pursuit> = {}) => ({ status, ...extra });
const filled = (d: ResumeData): Record<ResumeSection, boolean> => ({
    summary: !!d.generatedSummary?.trim(),
    experience: !!d.experience?.length,
    projects: !!d.projects?.length,
    skills: !!d.competencies?.length,
    education: !!d.education?.length,
});

/* ------------------------------ when it copies ------------------------------ */

test("copies on the move up into Applied, and onto a role created there", () => {
    assert.equal(attachesResumeOnApply(null, "applied"), true);
    assert.equal(attachesResumeOnApply(role("interested"), "applied"), true);
    assert.equal(attachesResumeOnApply(role("resume_ready"), "applied"), true);
});

test("never copies for any other stage, or for a role already at or past Applied", () => {
    for (const next of ["interested", "interviewing", "offer", "rejected", "withdrawn", undefined] as const) {
        assert.equal(attachesResumeOnApply(role("interested"), next), false, `to ${next}`);
    }
    for (const from of ["applied", "interviewing", "offer", "rejected", "withdrawn"] as const) {
        assert.equal(attachesResumeOnApply(role(from), "applied"), false, `from ${from}`);
    }
});

test("a role with a résumé already on it keeps that one", () => {
    // Moved back to Saved and up again: the first copy stays.
    assert.equal(attachesResumeOnApply(role("interested", { applied_resume: { saved_at: NOW } }), "applied"), false);
    // A tailored version an agent filed is what went out.
    const filed = { content: "Tailored", label: "Tailored for Acme", saved_at: NOW };
    assert.equal(attachesResumeOnApply(role("interested", { resume_versions: [filed] }), "applied"), false);
});

test("no résumé on file, no copy (never a placeholder)", () => {
    assert.equal(appliedResumeFor(null, "applied", null, NOW), undefined);
    assert.deepEqual(appliedResumeFor(null, "applied", "Jane Doe", NOW), { saved_at: NOW, content: "Jane Doe" });
});

/* ------------------------------- what it copies ------------------------------- */

test("an uploaded résumé's text is kept as it was; a structured one is written out as text", () => {
    assert.equal(resumeTextOnFile({ resume_text: `  ${SAMPLE_TEXT}  ` }), SAMPLE_TEXT.trim());
    assert.equal(resumeTextOnFile({ resume_data: SAMPLE_DATA, resume_text: "older text" }), resumeDataToPlainText(SAMPLE_DATA));
    assert.equal(resumeTextOnFile({ resume_text: "   " }), null);
    assert.equal(resumeTextOnFile(null), null);
});

test("the written-out text reads back into the same entries for every fixture résumé", () => {
    // Download renders the copy through resumeDataFromPlainText; markdown came
    // back with "# Jane Doe" as the name and "## SUMMARY" as a heading.
    const entries = (d: ResumeData) => ({
        name: d.profile?.name,
        profession: d.profile?.profession,
        contact: [d.profile?.location, d.profile?.email, d.profile?.phone, d.profile?.linkedin],
        summary: d.generatedSummary,
        experience: d.experience?.map((e) => [e.role, e.company, e.dates, e.description]),
        projects: d.projects?.map((e) => [e.role, e.company, e.dates, e.description]),
        skills: d.competencies?.map((c) => [c.category, c.skills]),
        education: d.education?.map((e) => [e.degree, e.institution, e.year]),
        // An empty section has nothing to print, so its heading goes with it.
        headings: Object.fromEntries(Object.entries(d.sectionHeadings ?? {}).filter(([section]) => filled(d)[section as ResumeSection])),
        extras: d.additionalSections,
        header: d.sourceHeader,
    });
    // A nurse's résumé in its own words: "Work History", a credential on the
    // name line, and Certifications and Languages where they stood.
    const ownWords = [
        "Amara Okafor, RN",
        "Calgary, AB | amara.okafor@example.com | (555) 010-7788",
        "",
        "PROFILE",
        "Critical care nurse with 7 years in adult ICU and step-down units.",
        "",
        "WORK HISTORY",
        "Registered Nurse, Adult ICU | Foothills Medical Centre Jan 2019 - Present",
        "• Cared for 2 ventilated patients per shift",
        "• Precepted 12 new graduate nurses",
        "",
        "CERTIFICATIONS",
        "ACLS, Heart and Stroke Foundation",
        "CNCC(C), Canadian Nurses Association",
        "",
        "EDUCATION",
        "Bachelor of Nursing | University of Calgary 2016",
        "",
        "LANGUAGES",
        "English, Yoruba",
    ].join("\n");
    const resumes = readdirSync(FIXTURES)
        .filter((f) => f.endsWith(".txt"))
        .map((f) => [f, readFileSync(join(FIXTURES, f), "utf8")] as const);
    assert.ok(resumes.length >= 5);
    for (const [name, original] of [...resumes, ["own-words", ownWords] as const]) {
        const data = resumeDataFromPlainText(original);
        const text = resumeDataToPlainText(data);
        assert.doesNotMatch(text, /^#/m, name);
        assert.deepEqual(entries(resumeDataFromPlainText(text)), entries(data), name);
    }
    const nurse = resumeDataFromPlainText(ownWords);
    assert.equal(nurse.additionalSections?.length, 2, "the own-words résumé exercises extra sections");
    assert.equal(nurse.sectionHeadings?.experience, "WORK HISTORY");
});

/* ---------------------------- account list and writes ---------------------------- */

test("the account's tracker list sends the copy's date, not its text", () => {
    const listed = withoutAppliedResumeText({ id: "a", applied_resume: { saved_at: NOW, content: SAMPLE_TEXT } });
    assert.deepEqual(listed, { id: "a", applied_resume: { saved_at: NOW } });
    const plain: Pick<Pursuit, "applied_resume"> & { id: string } = { id: "b" };
    assert.equal(withoutAppliedResumeText(plain), plain);
});

test("a status write from the browser can't set the copy itself", () => {
    assert.equal(validate(updateApplicationSchema, { status: "applied", applied_resume: { saved_at: NOW, content: "x" } }).ok, false);
});

test("a guest's copy carried in at sign-in must be a dated, capped résumé", () => {
    assert.equal(validate(guestAppliedResumeSchema, { saved_at: NOW, content: SAMPLE_TEXT }).ok, true);
    assert.equal(validate(guestAppliedResumeSchema, { saved_at: "yesterday", content: SAMPLE_TEXT }).ok, false);
    assert.equal(validate(guestAppliedResumeSchema, { saved_at: NOW, content: "   " }).ok, false);
    assert.equal(validate(guestAppliedResumeSchema, { saved_at: NOW, content: "x".repeat(50_001) }).ok, false);
    assert.equal(validate(guestAppliedResumeSchema, { saved_at: NOW, content: "x", user_id: "someone" }).ok, false);
});

/* ------------------------------------ guests ------------------------------------ */

beforeEach(() => {
    fakeLocalStorage.clear();
    clearGuestPursuits();
});

const putDeviceResume = () =>
    fakeLocalStorage.setItem(LOCAL_AI_RESUME_KEY, JSON.stringify({ data: SAMPLE_DATA, updatedAt: NOW }));

test("a guest's role marked Applied keeps this device's résumé; other writes leave it alone", () => {
    putDeviceResume();
    const saved = addManualGuestPursuit("Acme", "Engineer", { status: "interested" });
    assert.equal(saved.applied_resume, undefined);

    updateGuestPursuit(saved.id, { note: "call back Monday" });
    assert.equal(listGuestPursuits()[0].applied_resume, undefined);

    const applied = updateGuestPursuit(saved.id, { status: "applied" });
    assert.equal(applied?.applied_resume?.content, resumeDataToPlainText(SAMPLE_DATA));
    assert.ok(applied?.applied_resume?.saved_at);

    // Interviewing later keeps the same copy.
    const first = applied?.applied_resume;
    updateGuestPursuit(saved.id, { status: "interviewing" });
    assert.deepEqual(listGuestPursuits()[0].applied_resume, first);
});

test("a guest tracking a role as already applied keeps the résumé too; with none on the device, nothing", () => {
    const without = addManualGuestPursuit("Acme", "Engineer", { status: "applied" });
    assert.equal(without.applied_resume, undefined);
    putDeviceResume();
    const withResume = addManualGuestPursuit("Beta", "Engineer", { status: "applied" });
    assert.equal(withResume.applied_resume?.content, resumeDataToPlainText(SAMPLE_DATA));
});

test("a guest can take the copy off a role, and removing the résumé takes it off every role", () => {
    putDeviceResume();
    const a = addManualGuestPursuit("Acme", "Engineer", { status: "applied" });
    const b = addManualGuestPursuit("Beta", "Engineer", { status: "applied" });

    removeGuestAppliedResume(a.id);
    assert.equal(listGuestPursuits().find((p) => p.id === a.id)?.applied_resume, undefined);
    assert.ok(listGuestPursuits().find((p) => p.id === b.id)?.applied_resume);

    removeGuestAppliedResumes();
    assert.deepEqual(listGuestPursuits().map((p) => p.applied_resume), [undefined, undefined]);
    assert.ok(!fakeLocalStorage.getItem("intervu.pursuits.guest")?.includes("applied_resume"));
});

test("the copy is named the same everywhere it shows", () => {
    assert.equal(APPLIED_RESUME_LABEL, "Your résumé");
});
