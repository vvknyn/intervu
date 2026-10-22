import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LEAN_LEGAL_LINKS, LEGAL_LINKS } from "../../src/components/layout/Footer";

describe("footer links come from one list", () => {
    it("every footer variant carries About the checks", () => {
        for (const links of [LEGAL_LINKS, LEAN_LEGAL_LINKS]) {
            assert.ok(links.some((l) => l.label === "About the checks"));
        }
    });
    it("the lean variant is a subset of the full list, legal links included", () => {
        const full = new Set(LEGAL_LINKS.map((l) => l.href));
        for (const l of LEAN_LEGAL_LINKS) assert.ok(full.has(l.href), l.href);
        assert.deepEqual(LEAN_LEGAL_LINKS.map((l) => l.label).slice(-2), ["Privacy", "Terms"]);
    });
});
