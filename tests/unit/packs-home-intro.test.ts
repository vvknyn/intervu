import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    PACKS_HOME_INTRO_KEY,
    readPacksHomeIntroDismissed,
    writePacksHomeIntroDismissed,
} from "../../src/lib/jobs/for-you/packs-home-intro";
import { shouldShowJobsHomeViewToggle } from "../../src/lib/auth/jobs-chrome-gates";

describe("packs-home intro storage", () => {
    beforeEach(() => {
        try {
            globalThis.localStorage?.removeItem(PACKS_HOME_INTRO_KEY);
        } catch {
            /* no Storage */
        }
    });

    it("key matches the product contract", () => {
        assert.equal(PACKS_HOME_INTRO_KEY, "velai-packs-home-intro-v1");
    });

    it("read defaults to not-dismissed when storage empty or unavailable", () => {
        assert.equal(readPacksHomeIntroDismissed(), false);
    });

    it("write then read round-trips when localStorage exists", () => {
        if (typeof globalThis.localStorage === "undefined") {
            writePacksHomeIntroDismissed();
            assert.equal(readPacksHomeIntroDismissed(), false);
            return;
        }
        writePacksHomeIntroDismissed();
        assert.equal(readPacksHomeIntroDismissed(), true);
        assert.equal(globalThis.localStorage.getItem(PACKS_HOME_INTRO_KEY), "1");
    });
});

describe("packs-home chrome — no peer pill", () => {
    it("shouldShowJobsHomeViewToggle is always false", () => {
        assert.equal(
            shouldShowJobsHomeViewToggle({
                signedOut: false,
                resumeOnFile: true,
                showJobsHomePending: false,
            }),
            false,
        );
        assert.equal(
            shouldShowJobsHomeViewToggle({
                signedOut: false,
                resumeOnFile: null,
                showJobsHomePending: true,
            }),
            false,
        );
    });

    it("modal ships exact GTM copy (no score / Canada)", () => {
        const src = readFileSync(
            join(__dirname, "../../src/components/jobs/for-you/PacksHomeIntroModal.tsx"),
            "utf8",
        );
        assert.match(src, /Jobs with a résumé, not a search box/);
        assert.match(src, /Got it — show my packs/);
        assert.match(src, /Add or replace résumé/);
        assert.match(src, /Packs are the product now/);
        assert.match(src, /employer career\s+pages/);
        assert.doesNotMatch(src, /Canada|Toronto|\bscore\b|Strong\/Good\/Stretch/i);
    });

    it("jobs page mounts QuietSearchLink + PacksHomeIntroModal, not ForYouToggle", () => {
        const src = readFileSync(join(__dirname, "../../src/app/jobs/page.tsx"), "utf8");
        assert.doesNotMatch(src, /<ForYouToggle\b/);
        assert.match(src, /QuietSearchLink/);
        assert.match(src, /<PacksHomeIntroModal\b/);
    });

    it("CategoryHubGrid is default packs home — not gated on atRest", () => {
        const src = readFileSync(join(__dirname, "../../src/app/jobs/page.tsx"), "utf8");
        assert.match(src, /!showAdvancedSearch && !forYouPackDeckOpen/);
        assert.doesNotMatch(src, /atRest && !showAdvancedSearch \? \(/);
        assert.match(src, /onSelectCategory=\{\(category\) =>/);
        assert.match(src, /activeCategoryId=\{hubSelectedCategoryId\}/);
        assert.match(src, /setForYouPackDeckOpen\(true\)/);
        assert.match(src, /void resolveAndApplyFit\(\)/);
        assert.match(src, /data-testid="jobs-back-to-packs"/);
        const quiet = readFileSync(
            join(__dirname, "../../src/components/jobs/for-you/QuietSearchLink.tsx"),
            "utf8",
        );
        assert.match(quiet, /Advanced search →/);
        const hub = readFileSync(
            join(__dirname, "../../src/components/jobs/CategoryHubGrid.tsx"),
            "utf8",
        );
        assert.match(hub, /if \(onSelectCategory\)/);
        assert.match(hub, /data-testid="hub-browse-all-matches"/);
    });
});
