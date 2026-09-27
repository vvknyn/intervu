import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("for-you deck keyboard hint labels (axe-safe)", () => {
    it("uses readable Left/Right kbd labels instead of arrow glyphs", () => {
        const home = readFileSync(
            join(__dirname, "../../src/components/jobs/for-you/ForYouHome.tsx"),
            "utf8",
        );
        assert.match(home, /<Kbd>Left<\/Kbd>/);
        assert.match(home, /<Kbd>Right<\/Kbd>/);
        assert.doesNotMatch(home, /<Kbd>←<\/Kbd>/);
        assert.doesNotMatch(home, /<Kbd>→<\/Kbd>/);
        assert.match(home, /Next and Previous/);
    });
});
