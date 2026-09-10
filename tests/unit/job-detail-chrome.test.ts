import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const JOB_DETAIL = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetail.tsx");
const JOB_PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "[slug]", "page.tsx");
const JOB_DOCUMENT = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetailDocument.tsx");

describe("JobDetail guest chrome", () => {
    it("uses one guest apply label in action surfaces", () => {
        const src = readFileSync(JOB_DETAIL, "utf8");
        const guestLabels = src.match(/Sign in to apply/g) ?? [];
        assert.ok(guestLabels.length >= 2, "guest apply label should appear in header and action bar");
        assert.match(src, /\{signedIn \? "Apply" : "Sign in to apply"\}/);
    });

    it("save button uses bookmark icon when unsaved", () => {
        const src = readFileSync(JOB_DETAIL, "utf8");
        assert.match(src, /BookmarkSimple/);
        const saveBtn = src.slice(src.indexOf("goingAfter ? \"Saving…\" : \"Save\"") - 400, src.indexOf("goingAfter ? \"Saving…\" : \"Save\"") + 80);
        assert.match(saveBtn, /BookmarkSimple|Plus/);
        assert.doesNotMatch(saveBtn, /<Check size=\{16\} \/>\s*\{goingAfter/);
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
});
