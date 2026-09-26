import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(__dirname, "..", "..", "src", "app", "watch", "anywhere", "page.tsx");
const YOURS = join(__dirname, "..", "..", "src", "app", "yours", "page.tsx");
const TRACKER_BOARD = join(__dirname, "..", "..", "src", "components", "tracker", "TrackerKanbanBoard.tsx");
const PURSUIT_ROW = join(__dirname, "..", "..", "src", "components", "tracker", "PursuitListRow.tsx");
const CONTACT = join(__dirname, "..", "..", "src", "app", "contact", "page.tsx");

describe("watch anywhere copy", () => {
    it("uses device-neutral wording", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /this device/);
        assert.doesNotMatch(src, /this phone/);
    });
});

describe("yours tracker chrome", () => {
    it("lane jump nav scrolls inside the row on narrow viewports", () => {
        const src = readFileSync(TRACKER_BOARD, "utf8");
        assert.match(src, /overflow-x-auto/);
    });

    it("tracker subtitle is a complete sentence", () => {
        const src = readFileSync(YOURS, "utf8");
        assert.match(src, /Agent drafts still stop before they(?:'|&apos;)re sent\./);
        assert.doesNotMatch(src, /Agent drafts still stop before send\./);
    });

    it("search placeholder fits narrow tracker chrome", () => {
        const src = readFileSync(YOURS, "utf8");
        assert.match(src, /Search tracker…/);
        assert.doesNotMatch(src, /Search company or role/);
    });

    it("tracker header uses display masthead with stacked actions on narrow viewports", () => {
        const src = readFileSync(YOURS, "utf8");
        assert.match(src, /size="display"/);
    });

    it("lane rows wrap role titles up to two lines instead of one-line truncate", () => {
        const src = readFileSync(PURSUIT_ROW, "utf8");
        assert.match(src, /line-clamp-2 text-base font-semibold leading-snug text-foreground">\{pursuit\.position\}/);
        assert.doesNotMatch(src, /truncate text-base font-semibold leading-snug text-foreground">\{pursuit\.position\}/);
    });
});

describe("contact intro", () => {
    it("names Subspace as the job data partner for replies", () => {
        const src = readFileSync(CONTACT, "utf8");
        assert.match(src, /Subspace/);
        assert.match(src, /job data partner/i);
    });
});
