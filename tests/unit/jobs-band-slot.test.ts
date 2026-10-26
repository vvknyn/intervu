import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PROMO_BAND_PRIORITY, pickPromoBand } from "../../src/lib/jobs/promo-band";

const PAGE = readFileSync(join(__dirname, "../../src/app/jobs/JobsContent.tsx"), "utf8");

describe("the one band slot", () => {
    it("shows the résumé band to a viewer who needs it, ahead of any other band", () => {
        assert.equal(pickPromoBand({ resume: true, extension: false }), "resume");
        assert.equal(pickPromoBand({ resume: true, extension: true }), "resume");
        assert.equal(PROMO_BAND_PRIORITY[0], "resume");
    });
    it("falls to the extension tile, then to nothing", () => {
        assert.equal(pickPromoBand({ resume: false, extension: true }), "extension");
        assert.equal(pickPromoBand({ resume: false, extension: false }), null);
    });
    it("mounts the résumé band in the list slot before the first row, and nowhere below the list", () => {
        const mounts = [...PAGE.matchAll(/\{resumeBandEl\}/g)].map((m) => m.index!);
        assert.equal(mounts.length, 2, "front door (no list yet) and the list slot, nothing else");
        const listSlot = mounts[1];
        assert.ok(listSlot < PAGE.indexOf("<BoardVisitBanner"), "band precedes the list's banners");
        assert.ok(listSlot < PAGE.indexOf("<ExtensionTile"));
        assert.ok(listSlot < PAGE.indexOf("{resumeReadStripEl}"));
        assert.equal(PAGE.split("<FrontDoorResumeBand").length - 1, 1, "one element, mounted via resumeBandEl");
        assert.doesNotMatch(PAGE, /frontDoorBandVisible/, "no trailing mount keyed on the old gate");
    });
});
