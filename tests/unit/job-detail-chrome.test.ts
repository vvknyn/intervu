import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APPLY_BUTTON_LABEL } from "@/components/jobs/job-detail-facts";

const JOB_DETAIL = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetail.tsx");
const JOB_PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "[slug]", "page.tsx");
const JOB_DOCUMENT = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetailDocument.tsx");

describe("JobDetail guest chrome", () => {
    it("uses one shared Apply label for guests and signed-in users alike", () => {
        // Was: a bare ">Apply<" on the desktop split pane vs. a separately
        // hardcoded "Apply on Company Site" elsewhere in this same file — the
        // exact defect [3] inconsistency this test now guards against. Both
        // sites must read the one exported APPLY_BUTTON_LABEL constant
        // instead of re-typing (a different copy of) its text.
        const src = readFileSync(JOB_DETAIL, "utf8");
        assert.doesNotMatch(src, /Sign in to apply/);
        assert.doesNotMatch(src, />\s*Apply\s*</, "no surface should hardcode a bare, unlabeled Apply string");
        assert.doesNotMatch(src, /"Apply on Company Site"/, "no surface should re-type the label literal instead of importing it");
        assert.match(src, /\{APPLY_BUTTON_LABEL\}/, "every Apply surface must render the shared constant");
        assert.equal(APPLY_BUTTON_LABEL, "Apply on Company Site");
    });

    it("save control is the shared row bookmark, not a labeled Save button", () => {
        const src = readFileSync(JOB_DETAIL, "utf8");
        assert.match(src, /RowBookmarkButton/);
        assert.doesNotMatch(src, /goingAfter \? "Saving…" : "Save"/);
    });

    it("the job title is the page heading only on the standalone document", () => {
        // JobDetail mounts inside a page that already owns the h1 (the /jobs
        // masthead, or the company name on /co), so its own title is a
        // section heading, not the page heading. JobDetailDocument is the
        // standalone /jobs/[slug] document and owns the single h1 itself.
        const detail = readFileSync(JOB_DETAIL, "utf8");
        assert.match(
            detail,
            /<h[2-6][^>]*>\{jobTitle\}/,
            "the panel renders the presented (cased, decoded) title as a section heading",
        );
        assert.doesNotMatch(
            detail,
            /<h1\b/,
            "JobDetail only mounts under a page that already owns the h1 (/jobs masthead, /co company name)",
        );

        const doc = readFileSync(JOB_DOCUMENT, "utf8");
        assert.match(
            doc,
            /<h1[^>]*>\{jobTitle\}<\/h1>/,
            "the standalone document's h1 must render the presented title",
        );
        assert.equal(
            (doc.match(/<h1\b/g) ?? []).length,
            1,
            "the standalone document must own exactly one h1",
        );

        const page = readFileSync(JOB_PAGE, "utf8");
        assert.doesNotMatch(page, /<h1[^>]*>\s*\{job\.title\}/);
    });

    it("mounts every job-detail block exactly once (no parallel mobile/desktop copies)", () => {
        // Each block used to be referenced once in a `lg:hidden` mobile stack
        // AND once in a `hidden lg:grid` desktop grid — both mounted, so the
        // served HTML (and every effect inside these blocks) doubled. A
        // single CSS-reordered render must reference each block exactly once.
        const doc = readFileSync(JOB_DOCUMENT, "utf8");
        for (const block of ["heroEl", "applyCardEl", "receiptEl", "postingEl", "employerCardEl", "aiBoxEl"]) {
            const uses = doc.match(new RegExp(`\\{${block}\\}`, "g")) ?? [];
            assert.equal(uses.length, 1, `{${block}} must be referenced exactly once — a second reference re-mounts the block`);
        }
        // relatedEl is the one block that legitimately renders in two
        // different reading-order positions (closed vs. open jobs), but the
        // two uses must be mutually exclusive on `closed`, never both mounted.
        const relatedUses = doc.match(/\{relatedEl\}/g) ?? [];
        assert.equal(relatedUses.length, 2, "{relatedEl} must appear in exactly two guarded positions");
        assert.match(doc, /\{closed && <div[^>]*>\{relatedEl\}<\/div>\}/, "one relatedEl use must be gated on closed");
        assert.match(doc, /\{!closed && <div[^>]*>\{relatedEl\}<\/div>\}/, "the other relatedEl use must be gated on !closed");
    });

    it("every flowing-tag-list section (must-have skills, keywords) gates on visibleTags, not a raw array's .length", () => {
        // Was: `job.tags && job.tags.length > 0` — true even when every entry
        // decodes to a blank string, which rendered "Keywords from the
        // posting" (or "Must-have skills") as a heading over nothing. One
        // guard (`visibleTags(...).length > 0`) now covers every sibling
        // section instead of each one re-deriving its own raw-array check.
        const doc = readFileSync(JOB_DOCUMENT, "utf8");
        assert.doesNotMatch(doc, /job\.tags\s*&&\s*job\.tags\.length/, "keywords section must not gate on the raw array");
        assert.doesNotMatch(doc, /job\.must_have_skills\s*&&\s*job\.must_have_skills\.length/, "must-have-skills section must not gate on the raw array");
        const docVisibleTagsUses = doc.match(/visibleTags\(/g) ?? [];
        assert.ok(docVisibleTagsUses.length >= 4, `JobDetailDocument.tsx: expected both sections to gate AND render via visibleTags, found ${docVisibleTagsUses.length} call(s)`);

        const detail = readFileSync(JOB_DETAIL, "utf8");
        assert.doesNotMatch(detail, /job\.tags\s*&&\s*job\.tags\.length/, "JobDetail's keywords section must not gate on the raw array either");
        const detailVisibleTagsUses = detail.match(/visibleTags\(/g) ?? [];
        assert.ok(detailVisibleTagsUses.length >= 2, `JobDetail.tsx: expected the keywords section to gate AND render via visibleTags, found ${detailVisibleTagsUses.length} call(s)`);
    });
});
