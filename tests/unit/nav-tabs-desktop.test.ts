import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_TABS, NAV_TABS_DESKTOP } from "../../src/components/layout/nav-tabs";

/**
 * `MobileTabBar` renders one fixed icon per `NAV_TABS` entry off a
 * hand-written `TAB_ICONS` array (4 icons) — it isn't driven by this file,
 * so nothing type-checks that invariant. This test is the guard: `NAV_TABS`
 * must stay at exactly 4 entries, and any new top-level nav destination
 * (like Market trends) belongs in `NAV_TABS_DESKTOP` instead.
 */
test("NAV_TABS stays at 4 entries — MobileTabBar has exactly 4 hardcoded icons", () => {
    assert.equal(NAV_TABS.length, 4);
});

test("NAV_TABS_DESKTOP is NAV_TABS plus exactly one additional (desktop-only) tab", () => {
    assert.equal(NAV_TABS_DESKTOP.length, NAV_TABS.length + 1);
    for (const tab of NAV_TABS) {
        assert.ok(
            NAV_TABS_DESKTOP.some((t) => t.href === tab.href && t.label === tab.label),
            `NAV_TABS_DESKTOP is missing ${tab.href}`,
        );
    }
});

test("NAV_TABS_DESKTOP includes Market trends", () => {
    const trends = NAV_TABS_DESKTOP.find((t) => t.href === "/trends");
    assert.ok(trends, "expected a /trends entry in NAV_TABS_DESKTOP");
    assert.equal(trends?.label, "Market trends");
    assert.equal(trends?.match("/trends"), true);
    assert.equal(trends?.match("/trends/whatever"), true);
    assert.equal(trends?.match("/"), false);
});
