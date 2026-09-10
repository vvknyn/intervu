import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const JOB_DETAIL = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetail.tsx");
const JOB_PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "[slug]", "page.tsx");

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

    it("detail card owns the single visible title heading", () => {
        const detail = readFileSync(JOB_DETAIL, "utf8");
        // The h1 renders the cased, decoded title (`jobTitle`, assigned from
        // `presentJob(job).title` above) — not the raw `job.title` and not a
        // bare `decodeText(job.title)` that skips title-casing.
        assert.match(detail, /<h1[^>]*>\{jobTitle\}/);

        const page = readFileSync(JOB_PAGE, "utf8");
        assert.doesNotMatch(page, /<h1[^>]*>\s*\{job\.title\}/);
    });
});
