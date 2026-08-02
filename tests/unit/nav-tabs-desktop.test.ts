import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_TABS, NAV_TABS_DESKTOP } from "../../src/components/layout/nav-tabs";

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
