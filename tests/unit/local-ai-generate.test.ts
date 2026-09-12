import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateWithActiveEngine,
    resetLocalAiLadderForTests,
    rewriteWithActiveEngine,
} from "../../src/lib/local-ai/ladder";

describe("generateWithActiveEngine", () => {
    it("returns null when no active engine after reset", async () => {
        resetLocalAiLadderForTests();
        const out = await generateWithActiveEngine("Say hello");
        assert.equal(out, null);
    });

    it("rewriteWithActiveEngine returns null when no active engine", async () => {
        resetLocalAiLadderForTests();
        const out = await rewriteWithActiveEngine("Original text", "Rewrite for clarity");
        assert.equal(out, null);
    });
});
