import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_TABS, TRENDS_TAB } from "../../src/components/layout/nav-tabs";

/**
 * `MobileTabBar` renders one icon per `NAV_TABS` entry straight off that
 * entry's own `icon` field (nav-tabs.tsx) — replaced a hand-written 4-icon
 * array kept in lockstep by convention, so the invariant worth guarding is
 * now "every NAV_TABS entry supplies its own icon," not a specific count.
 * Adding or removing a tab in NAV_TABS is covered by construction; this test
 * would only fail if a *new* entry forgot to set `icon`.
 */
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

test("exactly one NAV_TABS entry is the cta variant, and it's Connect your AI", () => {
    const ctaTabs = NAV_TABS.filter((t) => t.variant === "cta");
    assert.equal(ctaTabs.length, 1);
    assert.equal(ctaTabs[0]?.href, "/connect");
});

test("NAV_TABS no longer markets /prep or /resume-builder as top-level nav", () => {
    for (const tab of NAV_TABS) {
        assert.notEqual(tab.href, "/prep");
        assert.notEqual(tab.href, "/resume-builder");
    }
});
