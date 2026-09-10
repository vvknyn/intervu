import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const JOB_DETAIL = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetail.tsx");
const JOB_PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "[slug]", "page.tsx");
const JOB_DOCUMENT = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetailDocument.tsx");

describe("JobDetail guest chrome", () => {
    it("uses Apply labels for guests and signed-in users alike", () => {
        const src = readFileSync(JOB_DETAIL, "utf8");
        assert.doesNotMatch(src, /Sign in to apply/);
        assert.match(src, />\s*Apply\s*</);
        assert.match(src, /Apply on Company Site/);
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
});
