import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    CHROME_EXTENSION_ID,
    CHROME_EXTENSION_LEAD,
    CHROME_EXTENSION_NAME,
    CHROME_EXTENSION_POINTS,
    CHROME_EXTENSION_STORE_URL,
} from "@/lib/brand/extension-store";

const read = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8");
const TILE = read("src/components/jobs/ExtensionTile.tsx");
const PAGE = read("src/app/jobs/JobsContent.tsx");

describe("the Velai Chrome extension tile", () => {
    it("links the extension's own Chrome Web Store item", () => {
        // A Chrome item id is 32 letters from a to p.
        assert.match(CHROME_EXTENSION_ID, /^[a-p]{32}$/);
        assert.equal(CHROME_EXTENSION_STORE_URL, `https://chromewebstore.google.com/detail/${CHROME_EXTENSION_ID}`);
    });

    it("says four things it does on a job page, each in a few words, and names no other company", () => {
        assert.deepEqual(
            CHROME_EXTENSION_POINTS.map((point) => point.id),
            ["fit", "posting", "resume", "apply"],
        );
        const copy = [CHROME_EXTENSION_NAME, CHROME_EXTENSION_LEAD, ...CHROME_EXTENSION_POINTS.map((point) => point.text)].join(" ");
        for (const point of CHROME_EXTENSION_POINTS) assert.ok(point.text.split(/\s+/).length <= 7, point.text);
        assert.doesNotMatch(copy, /linkedin|indeed|glassdoor|greenhouse|lever|workday|ashby|jobshifu/i);
        assert.doesNotMatch(TILE, /linkedin|indeed|glassdoor|greenhouse|workday|ashby|jobshifu/i);
    });

    it("opens the store in a new tab and never offers to open an extension it cannot see", () => {
        assert.match(TILE, /href=\{CHROME_EXTENSION_STORE_URL\}/);
        assert.match(TILE, /target="_blank"/);
        assert.match(TILE, /rel="noopener noreferrer"/);
        assert.match(TILE, /Add to Chrome/);
        assert.doesNotMatch(TILE, /Open (the )?extension|>\s*Open\s*</);
    });

    it("shows in the list slot only as the one promo band, never at the front door or per row", () => {
        assert.match(PAGE, /promoBand === "extension" && <ExtensionTile /);
        assert.equal(PAGE.split("<ExtensionTile").length - 1, 1);
        assert.doesNotMatch(PAGE, /extension-tile-list/);
    });
});
