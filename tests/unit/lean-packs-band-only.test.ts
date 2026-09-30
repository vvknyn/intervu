import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HUB = join(__dirname, "../../src/components/jobs/CategoryHubGrid.tsx");
const PACK = join(__dirname, "../../src/components/jobs/for-you/ForYouPack.tsx");
const NUMERIC_FIT_RE = /\d+\s*%\s*(match|fit|score)/i;

describe("lean packs surfaces — band only, no Canada claims in hub mock", () => {
    it("CategoryHubGrid never shows numeric % Match", () => {
        const src = readFileSync(HUB, "utf8");
        assert.doesNotMatch(src, /% Match/);
        assert.doesNotMatch(src, NUMERIC_FIT_RE);
        assert.doesNotMatch(src, /fitScorePercent/);
    });

    it("CategoryHubGrid carries no mock job catalog or fallback modal (a pack opens the real deck)", () => {
        const src = readFileSync(HUB, "utf8");
        assert.doesNotMatch(src, /CATEGORY_JOBS_CATALOG|RoleDetailListing/);
        assert.doesNotMatch(src, /<Dialog\b/);
    });

    it("ForYouPack deck header uses band label readout, not MatchChip component", () => {
        const src = readFileSync(PACK, "utf8");
        assert.doesNotMatch(src, /import.*MatchChip|<MatchChip/);
        assert.match(src, /function FitReadout/);
        assert.match(src, /matchBandLabel/);
    });
});
