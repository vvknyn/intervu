import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FOR_YOU_HOME = join(__dirname, "../../src/components/jobs/for-you/ForYouHome.tsx");

describe("ForYouHome skip vs replace controls", () => {
    it("Skip and Replace résumé stay distinct, with no coach strip", () => {
        const src = readFileSync(FOR_YOU_HOME, "utf8");

        assert.match(src, /data-testid="for-you-skip"[\s\S]*>\s*Skip\s*</);
        assert.doesNotMatch(src, /Getting around/);
        assert.match(src, /data-testid="jobs-replace-resume"[\s\S]*>\s*Replace résumé\s*</);

        const skipBlock = src.match(/data-testid="for-you-skip"[\s\S]{0,200}/)?.[0] ?? "";
        const replaceBlock = src.match(/data-testid="jobs-replace-resume"[\s\S]{0,200}/)?.[0] ?? "";

        assert.match(skipBlock, /onClick=\{onSkip\}/);
        assert.match(replaceBlock, /onClick=\{onReplaceResume\}/);
        assert.doesNotMatch(replaceBlock, /onSkip/);
    });
});
