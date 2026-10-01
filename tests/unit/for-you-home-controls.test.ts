import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FOR_YOU_HOME = join(__dirname, "../../src/components/jobs/for-you/ForYouHome.tsx");

describe("ForYouHome skip vs replace controls", () => {
    it("Skip and Replace résumé stay distinct, with no coach strip", () => {
        const src = readFileSync(FOR_YOU_HOME, "utf8");

        assert.match(src, /"for-you-skip"[\s\S]*>\s*Skip\s*</);
        assert.doesNotMatch(src, /Getting around/);
        assert.match(src, /data-testid="jobs-replace-resume"[\s\S]*>\s*Replace résumé\s*</);

        const skipBlock = src.match(/"for-you-skip"[\s\S]{0,200}/)?.[0] ?? "";
        const replaceBlock = src.match(/data-testid="jobs-replace-resume"[\s\S]{0,200}/)?.[0] ?? "";

        // The open card's Skip goes through skipActive, which lets the skipped
        // role tip back under the stack before calling onSkip.
        assert.match(skipBlock, /onClick=\{active \? skipActive : undefined\}/);
        assert.match(src, /const skipActive = useCallback\(\(\) => \{[\s\S]{0,200}onSkip\(\);/);
        assert.match(replaceBlock, /onClick=\{onReplaceResume\}/);
        assert.doesNotMatch(replaceBlock, /onSkip/);
    });

    it("a role stepped to with Next, Previous, an arrow key or a swipe counts as viewed; Skip's does not", () => {
        const src = readFileSync(FOR_YOU_HOME, "utf8");

        const goTo = src.match(/const goTo = useCallback\([\s\S]*?\n {4}\);/)?.[0] ?? "";
        assert.ok(goTo, "goTo is the one step helper");
        assert.match(goTo, /if \(next === selectedIndex\) return;/, "a step that goes nowhere records nothing");
        assert.match(goTo, /onOpenRow\?\.\(job\)/);

        assert.match(src, /data-testid="for-you-previous"\s+onClick=\{\(\) => goTo\(selectedIndex - 1\)\}/);
        assert.match(src, /data-testid="for-you-next"\s+onClick=\{\(\) => goTo\(selectedIndex \+ 1\)\}/);
        assert.match(src, /onSwipe=\{\(direction\) => goTo\(/);
        assert.match(src, /action === "previous"\) \{\s+goTo\(selectedIndex - 1\);/);
        assert.match(src, /action === "next"\) \{\s+goTo\(selectedIndex \+ 1\);/);
        assert.equal(src.match(/onActiveIndexChange\(/g)?.length, 2, "only goTo and the out-of-range reset move the deck");

        const skip = src.match(/const skipActive = useCallback\([\s\S]*?\n {4}\}, /)?.[0] ?? "";
        assert.doesNotMatch(skip, /onOpenRow/);
    });
});
