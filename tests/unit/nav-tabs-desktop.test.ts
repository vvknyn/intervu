import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_TABS, TRENDS_TAB } from "../../src/components/layout/nav-tabs";

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

test("Connect tab is present with its own icon and no cta variant", () => {
    const connect = NAV_TABS.find((t) => t.href === "/connect");
    assert.ok(connect);
    assert.equal(connect?.label, "Connect");
    assert.ok(connect?.icon);
    assert.equal(connect?.variant, undefined);
});

test("NAV_TABS no longer markets /prep or /resume-builder as top-level nav", () => {
    for (const tab of NAV_TABS) {
        assert.notEqual(tab.href, "/prep");
        assert.notEqual(tab.href, "/resume-builder");
    }
});

test("Connect nav is not active on /openclaw", () => {
    const connect = NAV_TABS.find((t) => t.href === "/connect");
    assert.ok(connect);
    assert.equal(connect!.match("/openclaw"), false);
    assert.equal(connect!.match("/connect"), true);
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
