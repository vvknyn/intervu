import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "page.tsx");
const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");
const BELL = join(__dirname, "..", "..", "src", "components", "follows", "FollowAlertsBell.tsx");

describe("follow alerts bell relocation", () => {
    it("jobs page no longer mounts the list banner", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.doesNotMatch(src, /FollowAlertsCard/);
        assert.doesNotMatch(src, /follow-alerts-card/);
    });

    it("TopBar mounts the header bell before account chrome", () => {
        const src = readFileSync(TOPBAR, "utf8");
        assert.match(src, /FollowAlertsBell/);
        const cluster = src.slice(src.indexOf('className="flex shrink-0 items-center gap-3"'));
        const bellIdx = cluster.indexOf("FollowAlertsBell");
        const accountIdx = cluster.indexOf('authChrome === "authenticated" && user ?');
        assert.ok(bellIdx > -1 && accountIdx > bellIdx, "bell sits left of account chrome");
    });

    it("bell trigger exposes topbar-follow-alerts test id", () => {
        const src = readFileSync(BELL, "utf8");
        assert.match(src, /topbar-follow-alerts/);
    });

    it("bell uses Popover, cursor ack, and a manage-follows CTA (not the elite board)", () => {
        const src = readFileSync(BELL, "utf8");
        assert.match(src, /Popover/);
        assert.match(src, /writeFollowAlertCursor/);
        assert.match(src, /acknowledge/);
        assert.doesNotMatch(src, /board=elite/);
        assert.match(src, /MANAGE_FOLLOWS_HREF/);
        assert.match(src, /follow-alerts-cta/);
        assert.match(src, /useFollows/);
    });

    it("bell keeps slot with skeleton while loading", () => {
        const src = readFileSync(BELL, "utf8");
        assert.match(src, /topbar-follow-alerts-skeleton/);
        assert.match(src, /if \(loading\)/);
    });
});
