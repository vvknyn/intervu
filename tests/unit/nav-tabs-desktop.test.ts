import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESUME_TAB, NAV_TABS, TRENDS_TAB, resumeTabLabel, mobilePrimaryTabs } from "../../src/components/layout/nav-tabs";

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

test("the nav has exactly one résumé entry and it points at /resume, not the AI pairing", () => {
    const resumeTabs = NAV_TABS.filter((t) => /résumé/i.test(t.label));
    assert.deepEqual(resumeTabs, [RESUME_TAB]);
    assert.equal(RESUME_TAB.href, "/resume");
    assert.equal(RESUME_TAB.match("/resume"), true);
    assert.equal(RESUME_TAB.match("/connect"), false);
    assert.ok(RESUME_TAB.icon);
    assert.equal(RESUME_TAB.variant, undefined);
    assert.ok(!NAV_TABS.some((t) => t.href === "/connect"), "the AI pairing is reached from Settings, not the nav");
});

test("resumeTabLabel reflects résumé presence, connected and not", () => {
    assert.equal(resumeTabLabel(false), "Add résumé");
    assert.equal(resumeTabLabel(true), "Résumé");
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

test("the résumé tab is on the mobile bar as well as the desktop bar", () => {
    assert.ok(mobilePrimaryTabs(NAV_TABS).includes(RESUME_TAB));
});

test("current-page marker is the shared tab primitive's bar, driven by aria-current", () => {
    const src = readFileSync(TOPBAR, "utf8");
    const navBlock = src.slice(src.indexOf("navTabs.map"), src.indexOf("</TabNav>"));
    assert.match(navBlock, /<TabItem\b[^>]*current=\{active \? "page" : false\}/);
    assert.doesNotMatch(navBlock, /border-b-2/, "TopBar must not paint its own underline");
    const tabs = readFileSync(join(__dirname, "..", "..", "src", "components", "ui", "tabs.tsx"), "utf8");
    assert.match(tabs, /aria-\[current\]:after:bg-brand/);
});

test("guest /admin redirects to login with next, not the public SERP", () => {
    const src = readFileSync(ADMIN, "utf8");
    assert.match(src, /redirect\("\/login\?next=\/admin"\)/);
    assert.match(src, /redirect\("\/"\)/);
    assert.match(src, /getServerUser/);
    assert.match(src, /isAdminUser/);
});
