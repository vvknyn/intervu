import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseResumeLocally } from "../../src/lib/local-ai/parse-resume";
import { applyTailorChanges, heuristicTailorResume, resumeFullText, type TailorDraft } from "../../src/lib/local-ai/tailor-resume";
import { groundDraft, tailorWithRules } from "../../src/lib/local-ai/tailor-with-engine";
import { descriptionToBullets } from "../../src/lib/resume/merge-bullet-lines";
import type { ResumeData } from "../../src/types/resume";
import { LONG_RESUME_POSTINGS, TAILOR_POSTINGS } from "../fixtures/job-descriptions/tailor-postings";

/**
 * Tailoring every résumé in the corpus (tests/fixtures/resume-corpus: twenty
 * roles, eleven countries) and the longer fixtures to a posting for its kind
 * of role. Vivek 2026-10-10: "only the skill section is tweaked ... there
 * could be other updates like wordings for their job experiences". Before
 * that day the rules draft reworded 0 of the corpus's 61 lines and 0 of its
 * summaries; only skills moved.
 *
 * Whatever it changes, a tailored résumé says only what the résumé says: the
 * same employers, titles, dates and schools, no number the résumé doesn't
 * have, every rewording passing the grounding gate, and every change undoable.
 */

const DIR = path.join(process.cwd(), "tests/fixtures");

async function readResume(file: string): Promise<ResumeData> {
    const parsed = (await parseResumeLocally(readFileSync(path.join(DIR, file), "utf8"), { skipDownload: true })).data.parsed;
    return { ...parsed, generatedSummary: parsed.generatedSummary ?? "" };
}

const numbersIn = (text: string) => new Set(text.match(/\d+/g) ?? []);

function wholeText(r: ResumeData): string {
    return [
        r.generatedSummary,
        ...r.experience.flatMap((e) => [e.role, e.company, e.dates, e.description]),
        ...(r.projects ?? []).flatMap((e) => [e.role, e.company, e.dates, e.description]),
        ...r.competencies.flatMap((c) => [c.category, ...c.skills]),
    ].join("\n");
}

function assertTruthful(base: ResumeData, draft: TailorDraft) {
    const t = draft.tailored;
    assert.deepEqual(t.profile, base.profile);
    assert.deepEqual(t.education, base.education);
    assert.deepEqual(
        t.experience.map((e) => [e.id, e.role, e.company, e.dates]),
        base.experience.map((e) => [e.id, e.role, e.company, e.dates]),
    );
    for (const [i, e] of t.experience.entries()) {
        assert.equal(descriptionToBullets(e.description).length, descriptionToBullets(base.experience[i].description).length, `${e.role}: same number of lines`);
    }
    assert.deepEqual(
        t.competencies.map((c) => [c.category, c.skills.length]),
        base.competencies.map((c) => [c.category, c.skills.length]),
    );
    const known = numbersIn(wholeText(base));
    for (const n of numbersIn(wholeText(t))) assert.ok(known.has(n), `number ${n} is on the résumé`);
    for (const c of draft.changes) assert.ok(c.why.trim().length > 0, `${c.id} says why`);
}

function assertUndoable(base: ResumeData, draft: TailorDraft) {
    assert.deepEqual(applyTailorChanges(base, []), base, "undoing every change gives the résumé back");
    for (const change of draft.changes) {
        const without = applyTailorChanges(base, draft.changes.filter((c) => c.id !== change.id));
        if (change.kind === "summary") assert.equal(without.generatedSummary, change.before);
        if (change.kind === "line") {
            const list = change.source === "project" ? without.projects! : without.experience;
            const lines = descriptionToBullets(list.find((e) => e.id === change.entryId)!.description);
            assert.ok(lines.includes(change.before), `undoing ${change.id} brings back "${change.before}"`);
            assert.ok(!lines.includes(change.after), `undoing ${change.id} removes "${change.after}"`);
        }
        if (change.kind === "skills") assert.deepEqual(without.competencies[change.group].skills, change.before);
    }
}

const corpus = Object.entries(TAILOR_POSTINGS).map(([id, job]) => ({ file: `resume-corpus/${id}.paste.txt`, job }));
const longer = Object.entries(LONG_RESUME_POSTINGS).map(([file, job]) => ({ file, job }));

describe("tailoring the résumé corpus to a posting for each", () => {
    const drafts = new Map<string, { base: ResumeData; draft: TailorDraft }>();

    for (const { file, job } of [...corpus, ...longer]) {
        it(`${file} → ${job.title}: truthful, grounded, undoable`, async () => {
            const base = await readResume(file);
            const raw = heuristicTailorResume(base, job);
            const grounded = groundDraft(resumeFullText(base), raw);
            assert.deepEqual(
                raw.changes.filter((c) => !grounded.changes.includes(c)).map((c) => c.id),
                [],
                "the rules never write what the grounding gate would drop",
            );
            const draft = tailorWithRules(base, job);
            assert.ok(draft.changes.length > 0, "something is tailored for the posting");
            assertTruthful(base, draft);
            assertUndoable(base, draft);
            drafts.set(file, { base, draft });
        });
    }

    it("rewords summaries and experience lines across the corpus, not only skills", () => {
        const corpusDrafts = corpus.map(({ file }) => drafts.get(file)!);
        const withSummary = corpusDrafts.filter(({ base }) => base.generatedSummary.trim());
        const summaries = corpusDrafts.filter(({ draft }) => draft.changes.some((c) => c.kind === "summary")).length;
        const lines = corpusDrafts.reduce((n, { draft }) => n + draft.changes.filter((c) => c.kind === "line").length, 0);
        assert.ok(summaries >= 12, `${summaries} of ${withSummary.length} summaries tailored`);
        assert.ok(lines >= 4, `${lines} lines reworded`);
    });

    it("a résumé without a summary doesn't get one", () => {
        for (const { base, draft } of drafts.values()) {
            if (!base.generatedSummary.trim()) assert.equal(draft.tailored.generatedSummary, base.generatedSummary);
        }
    });

    it("the nurse: charting is documenting and precepting is mentoring, as the posting says; its skills close the summary", () => {
        const { draft } = drafts.get("resume-corpus/nurse-ca.paste.txt")!;
        const lines = draft.changes.flatMap((c) => (c.kind === "line" ? [c.after] : []));
        assert.ok(lines.includes("Documented all assessments and medication administration in Epic."), JSON.stringify(lines));
        assert.ok(lines.includes("Mentor new graduate nurses through their first twelve weeks on the unit."), JSON.stringify(lines));
        assert.match(draft.tailored.generatedSummary, /Core skills include IV Therapy, Wound Care and Patient Education\.$/);
    });

    it("the call-centre agent: customer satisfaction is spelled out as the posting abbreviates it", () => {
        const { draft } = drafts.get("resume-corpus/csr-ph.paste.txt")!;
        assert.ok(draft.changes.some((c) => c.kind === "line" && c.after === "Keep a customer satisfaction (CSAT) score above 92%."));
    });

    it("never adds a skill the résumé doesn't list: Revit, Salesforce, Tableau, Oracle stay out", () => {
        for (const { base, draft } of drafts.values()) {
            const before = wholeText(base).toLowerCase();
            const after = wholeText(draft.tailored).toLowerCase();
            for (const skill of ["revit", "salesforce", "tableau", "oracle", "tiktok", "healthwatch", "cerner"]) {
                if (!before.includes(skill)) assert.ok(!after.includes(skill), `${skill} added`);
            }
        }
    });
});
