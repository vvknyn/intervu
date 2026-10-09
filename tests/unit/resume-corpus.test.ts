import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { canAcceptLocalParse } from "../../src/lib/local-ai/parse-confidence";
import { parseResumeLocally } from "../../src/lib/local-ai/parse-resume";
import { refuseResumeReview } from "../../src/lib/resume/profile-review-parse";

/**
 * Twenty invented résumés (tests/fixtures/resume-corpus): nurse, teacher,
 * electrician, driver, barista, accountant, engineers, lawyer, warehouse,
 * chef and more, from Canada, the US, the UK, Ireland, India, Germany,
 * Nigeria, the Philippines, the UAE, Brazil and Australia, with the
 * headings, date styles and role layouts real ones use. Each comes as the
 * text a person pastes, the text a two-column PDF extracts to, and what
 * on-device OCR reads off a scan and off a phone photo of the printed page.
 *
 * The quick read must get, from every one, what matching needs without the
 * person typing it in: the name, the title, every role with its employer,
 * nearly every skill, and every school. Before 2026-10-09 it got 65 of the
 * 165 files right (two-column PDFs lost the second job and the school; a
 * second job written as the employer over "Title | dates", or as a title
 * over "Employer, Town" and the dates, lost its employer; "Qualifications",
 * "Professional Profile" and "About Me" were not read as sections; scans
 * had no text at all).
 */

const DIR = path.join(process.cwd(), "tests/fixtures/resume-corpus");
const FORMATS = ["paste", "two-column-pdf", "scan-ocr", "phone-photo-ocr"] as const;

interface Truth {
    name: string;
    title: string;
    experience: Array<{ title: string; company: string }>;
    skills: string[];
    education: Array<{ degree: string; school: string }>;
}

const norm = (s: unknown) =>
    String(s ?? "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9+#]+/g, " ")
        .trim();
const same = (a: unknown, b: unknown) => norm(a) === norm(b);
const has = (hay: unknown, needle: unknown) => norm(hay).includes(norm(needle));

/** The English OCR model reads "João" as "Jodo" and "Agência Pólen" as "Agéncia Polen": accents it has no letters for. */
const OCR_ACCENT_GAPS = new Set(["designer-br/phone-photo-ocr"]);

const ids = readdirSync(DIR)
    .filter((f) => f.endsWith(".truth.json"))
    .map((f) => f.replace(".truth.json", ""));

describe("résumé corpus: the quick read gets what matching needs from every layout", () => {
    it("has the twenty résumés", () => assert.equal(ids.length, 20));

    for (const id of ids) {
        const truth = JSON.parse(readFileSync(path.join(DIR, `${id}.truth.json`), "utf8")) as Truth;
        for (const format of FORMATS) {
            if (OCR_ACCENT_GAPS.has(`${id}/${format}`)) continue;
            it(`${id} (${format})`, async () => {
                const text = readFileSync(path.join(DIR, `${id}.${format}.txt`), "utf8");
                const parsed = (await parseResumeLocally(text, { skipDownload: true })).data.parsed;
                assert.equal(refuseResumeReview(parsed, text), null, "review opens");
                assert.ok(canAcceptLocalParse(parsed), "ranks without hand-filling");
                assert.ok(same(parsed.profile.name, truth.name), `name: ${parsed.profile.name}`);
                assert.ok(
                    same(parsed.profile.profession, truth.title) || same(parsed.experience[0]?.role, truth.experience[0].title),
                    `title: ${parsed.profile.profession}`,
                );
                const roles = parsed.experience.map((e) => `${e.role} @ ${e.company}`);
                for (const job of truth.experience) {
                    assert.ok(
                        parsed.experience.some(
                            (e) =>
                                same(e.role, job.title) &&
                                (has(e.company, job.company) || (norm(e.company).length >= 3 && has(job.company, e.company))),
                        ),
                        `role ${job.title} @ ${job.company} in ${JSON.stringify(roles)}`,
                    );
                }
                const skills = parsed.competencies.flatMap((c) => c.skills);
                const found = truth.skills.filter((s) => skills.some((x) => same(x, s)));
                assert.ok(found.length >= Math.ceil(truth.skills.length * 0.85), `skills ${found.length}/${truth.skills.length}: ${JSON.stringify(skills)}`);
                const schools = parsed.education.map((e) => `${e.degree} @ ${e.institution}`);
                for (const school of truth.education) {
                    assert.ok(
                        parsed.education.some((e) => has(e.degree, school.degree) && has(e.institution, school.school)),
                        `education ${school.degree} @ ${school.school} in ${JSON.stringify(schools)}`,
                    );
                }
            });
        }
    }
});
