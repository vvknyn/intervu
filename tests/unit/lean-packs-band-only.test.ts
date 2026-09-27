import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HUB = join(__dirname, "../../src/components/jobs/CategoryHubGrid.tsx");
const PACK = join(__dirname, "../../src/components/jobs/for-you/ForYouPack.tsx");
const NUMERIC_FIT_RE = /\d+\s*%\s*(match|fit|score)/i;

describe("lean packs surfaces — band only, no Canada claims in hub mock", () => {
    it("CategoryHubGrid mock + fallback modal never show numeric % Match", () => {
        const src = readFileSync(HUB, "utf8");
        assert.doesNotMatch(src, /% Match/);
        assert.doesNotMatch(src, NUMERIC_FIT_RE);
        assert.doesNotMatch(src, /fitScorePercent/);
        assert.match(src, /matchBandLabel/);
    });

    it("CategoryHubGrid mock catalog has no Canada location claims", () => {
        const src = readFileSync(HUB, "utf8");
        const catalog = src.split("export const CATEGORY_JOBS_CATALOG")[1]?.split("export ")[0] ?? "";
        assert.doesNotMatch(catalog, /Canada|Toronto/i);
    });

    it("ForYouPack deck header uses band label readout, not MatchChip component", () => {
        const src = readFileSync(PACK, "utf8");
        assert.doesNotMatch(src, /import.*MatchChip|<MatchChip/);
        assert.match(src, /function FitReadout/);
        assert.match(src, /matchBandLabel/);
    });
});
