import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    armFirstPackReveal,
    consumeFirstPackReveal,
    FIRST_PACK_REVEAL_KEY,
} from "../../src/lib/jobs/for-you/first-pack-reveal";

describe("first-pack-reveal session latch", () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    afterEach(() => {
        sessionStorage.clear();
    });

    it("arms and consumes once", () => {
        armFirstPackReveal();
        assert.equal(sessionStorage.getItem(FIRST_PACK_REVEAL_KEY), "1");
        assert.equal(consumeFirstPackReveal(), true);
        assert.equal(consumeFirstPackReveal(), false);
        assert.equal(sessionStorage.getItem(FIRST_PACK_REVEAL_KEY), null);
    });

    it("jobs page wires arm on onboarding complete and import", () => {
        const page = readFileSync(join(__dirname, "../../src/app/jobs/page.tsx"), "utf8");
        assert.match(page, /armFirstPackReveal\(\)/);
        assert.match(page, /consumeFirstPackReveal\(\)/);
        assert.match(page, /first-pack-reveal-handoff/);
    });
});
