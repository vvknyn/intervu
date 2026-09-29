import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldAnimateJobsHomeViewSwap } from "../../src/lib/motion/home-view-transition";

const ROOT = join(__dirname, "..", "..");

describe("jobs home view crossfade policy", () => {
    it("animates only between resolved for-you and search surfaces", () => {
        assert.equal(shouldAnimateJobsHomeViewSwap("for-you", "search"), true);
        assert.equal(shouldAnimateJobsHomeViewSwap("search", "for-you"), true);
        assert.equal(shouldAnimateJobsHomeViewSwap("pending", "for-you"), false);
        assert.equal(shouldAnimateJobsHomeViewSwap("for-you", "pending"), false);
        assert.equal(shouldAnimateJobsHomeViewSwap("pending", "search"), false);
        assert.equal(shouldAnimateJobsHomeViewSwap("for-you", "for-you"), false);
    });

    it("globals.css wires page token to jobs-home-view-crossfade", () => {
        const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
        assert.match(css, /\.jobs-home-view-crossfade/);
        assert.match(css, /jobs-home-view-crossfade-in var\(--transition-page\)/);
    });

    it("jobs page wraps the home column in JobsHomeViewTransition", () => {
        const page = readFileSync(join(ROOT, "src/app/jobs/JobsContent.tsx"), "utf8");
        assert.match(page, /<JobsHomeViewTransition surface=\{resolvedHomeView\}>/);
    });
});
