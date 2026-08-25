import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(__dirname, "..", "..", "src", "app", "watch", "anywhere", "page.tsx");
const YOURS = join(__dirname, "..", "..", "src", "app", "yours", "page.tsx");
const CONTACT = join(__dirname, "..", "..", "src", "app", "contact", "page.tsx");

describe("watch anywhere copy", () => {
    it("uses device-neutral wording", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /this device/);
        assert.doesNotMatch(src, /this phone/);
    });
});

describe("yours tracker chrome", () => {
    it("status tabs scroll inside the row on narrow viewports", () => {
        const src = readFileSync(YOURS, "utf8");
        const chips = src.slice(src.indexOf("function StatusChips"), src.indexOf("function YoursContent"));
        assert.match(chips, /overflow-x-auto/);
    });

    it("tracker subtitle is a complete sentence", () => {
        const src = readFileSync(YOURS, "utf8");
        assert.match(src, /Agent drafts still stop before they(?:'|&apos;)re sent\./);
        assert.doesNotMatch(src, /Agent drafts still stop before send\./);
    });
});

describe("contact intro", () => {
    it("names Subspace as the job data partner for replies", () => {
        const src = readFileSync(CONTACT, "utf8");
        assert.match(src, /Subspace/);
        assert.match(src, /job data partner/i);
    });
});
