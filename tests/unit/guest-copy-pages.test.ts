import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRACKER_PAGE_SUBCOPY } from "../../src/lib/pursuits/tracker-voice-copy";

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

    it("tracker subtitle communicates journey and control without agent jargon", () => {
        const src = readFileSync(YOURS, "utf8");
        assert.match(src, /TRACKER_PAGE_SUBCOPY/);
        assert.match(TRACKER_PAGE_SUBCOPY, /from saved to offer/i);
        assert.match(TRACKER_PAGE_SUBCOPY, /You decide what gets sent/i);
        assert.doesNotMatch(TRACKER_PAGE_SUBCOPY, /Agent|records|submissions/i);
    });

    it("search placeholder fits narrow tracker chrome", () => {
        const src = readFileSync(YOURS, "utf8");
        assert.match(src, /Search tracker…/);
        assert.doesNotMatch(src, /Search company or role/);
    });

    it("tracker header uses the one PageHeader masthead (stacked actions on narrow viewports)", () => {
        const src = readFileSync(YOURS, "utf8");
        assert.match(src, /<PageHeader/);
        // The masthead has one look now; a size prop would mean a second one crept back.
        assert.doesNotMatch(src, /<PageHeader[^>]*\bsize=/);
    });

    it("lane row role title shows full text — no truncate or line-clamp", () => {
        const src = readFileSync(PURSUIT_ROW, "utf8");
        const roleBlock = src.match(/data-testid="pursuit-role-title"[\s\S]*?\{pursuit\.position\}/)?.[0] ?? "";
        assert.ok(roleBlock.length > 0, "expected pursuit role title block");
        assert.match(roleBlock, /whitespace-normal/);
        assert.doesNotMatch(roleBlock, /\btruncate\b/, "role title must not use truncate");
        assert.doesNotMatch(roleBlock, /line-clamp/, "role title must not use line-clamp");
        assert.doesNotMatch(roleBlock, /tracker-role-title/, "obsolete tracker-role-title utility removed");
        assert.match(src, /whitespace-normal/, "pursuit row button must not inherit single-line nowrap");
        const globals = readFileSync(join(__dirname, "..", "..", "src", "app", "globals.css"), "utf8");
        assert.doesNotMatch(globals, /@utility tracker-role-title/, "no custom clamp utility for role titles");
        assert.doesNotMatch(globals, /\.tracker-role-title/, "no legacy tracker-role-title CSS rule");
    });
});

describe("contact intro", () => {
    it("names Subspace as the job data partner for replies", () => {
        const src = readFileSync(CONTACT, "utf8");
        assert.match(src, /Subspace/);
        assert.match(src, /job data partner/i);
    });
});
