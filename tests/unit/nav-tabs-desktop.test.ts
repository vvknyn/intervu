import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONNECT_TAB, NAV_TABS, TRENDS_TAB, connectTabLabel, mobilePrimaryTabs } from "../../src/components/layout/nav-tabs";

const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");
const ADMIN = join(__dirname, "..", "..", "src", "app", "admin", "page.tsx");

test("every NAV_TABS entry carries its own icon (MobileTabBar has nothing left to hardcode)", () => {
    assert.ok(NAV_TABS.length > 0);
    for (const tab of NAV_TABS) {
        assert.ok(tab.icon, `${tab.href} is missing an icon`);
    }
});

test("TRENDS_TAB is a footer-only /trends entry", () => {
    assert.equal(TRENDS_TAB.href, "/trends");
    assert.equal(TRENDS_TAB.label, "Market trends");
    assert.equal(TRENDS_TAB.match("/trends"), true);
    assert.equal(TRENDS_TAB.match("/trends/whatever"), true);
    assert.equal(TRENDS_TAB.match("/"), false);
});

test("Agents tab is present with its own icon and no cta variant", () => {
    const connect = NAV_TABS.find((t) => t.href === "/connect");
    assert.ok(connect);
    assert.equal(connect?.label, "Add résumé");
    assert.equal(connect?.shortLabel, "Add résumé");
    assert.ok(connect?.icon);
    assert.equal(connect?.variant, undefined);
});

test("connectTabLabel reflects résumé presence without hardcoding Connect AI", () => {
    assert.equal(connectTabLabel(false), "Add résumé");
    assert.equal(connectTabLabel(true), "Résumé & AI");
});

test("NAV_TABS no longer markets /prep or /resume-builder as top-level nav", () => {
    for (const tab of NAV_TABS) {
        assert.notEqual(tab.href, "/prep");
        assert.notEqual(tab.href, "/resume-builder");
    }
});

test("mobilePrimaryTabs: mobilePrimary:false is excluded; a tab without the field is included", () => {
    const optedOut: import("../../src/components/layout/nav-tabs").NavTab = {
        ...NAV_TABS[0],
        href: "/opted-out",
        testId: "opted-out",
        mobilePrimary: false,
    };
    const unset: import("../../src/components/layout/nav-tabs").NavTab = {
        ...NAV_TABS[0],
        href: "/unset",
        testId: "unset",
    };
    const result = mobilePrimaryTabs([optedOut, unset]);
    assert.deepEqual(result.map((t) => t.href), ["/unset"]);
});

test("Connect AI tab opts out of the mobile bar but stays a desktop bar tab", () => {
    assert.equal(CONNECT_TAB.mobilePrimary, false);
    assert.equal(CONNECT_TAB.placement, "bar");
    assert.ok(NAV_TABS.includes(CONNECT_TAB), "must still be in the desktop-rendered NAV_TABS");
    assert.ok(!mobilePrimaryTabs(NAV_TABS).includes(CONNECT_TAB), "must be filtered out of the mobile bar's tab list");
});

test("Connect nav is not active on /openclaw", () => {
    const agents = NAV_TABS.find((t) => t.href === "/connect");
    assert.ok(agents);
    assert.equal(agents!.match("/openclaw"), false);
    assert.equal(agents!.match("/connect"), true);
});

test("current-page underline wraps the label box, not padded link chrome", () => {
    const src = readFileSync(TOPBAR, "utf8");
    const barBlock = src.slice(src.indexOf("barTabs.map"), src.indexOf("{user ?"));
    assert.match(barBlock, /<span className=\{cn\(active && "border-b-2 border-brand"\)\}/);
    assert.doesNotMatch(barBlock, /active\s*\?\s*"border-b-2 border-brand text-brand/);
});

test("guest /admin redirects to login with next, not the public SERP", () => {
    const src = readFileSync(ADMIN, "utf8");
    assert.match(src, /redirect\("\/login\?next=\/admin"\)/);
    assert.match(src, /redirect\("\/"\)/);
    assert.match(src, /getServerUser/);
    assert.match(src, /isAdminUser/);
});
