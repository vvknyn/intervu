import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ForYouToggle } from "../../src/components/jobs/for-you/ForYouToggle";
import type { JobsHomeView } from "../../src/lib/jobs/for-you/home-view";

/**
 * Decision 2: the For you <-> Search mode control is a pill segmented
 * control built on `chipVariants`, not the old tab strip. This is a plain
 * function component with no internal hooks, so calling it directly (no
 * jsdom in this repo) gives back the real React element tree — walking it
 * lets these tests invoke each tab's own `onClick` and prove the mode
 * actually switches, not just that the markup looks right.
 */
function tabButtons(value: JobsHomeView, onChange: (v: JobsHomeView) => void) {
    const tree = ForYouToggle({ value, onChange }) as React.ReactElement<{ children: React.ReactElement[] }>;
    return tree.props.children;
}

test("clicking the 'Search' tab while 'for-you' is active calls onChange('search') exactly once", () => {
    const calls: JobsHomeView[] = [];
    const buttons = tabButtons("for-you", (v) => calls.push(v));
    const searchTab = buttons.find((b) => b.key === "search")!;
    (searchTab.props as { onClick: () => void }).onClick();
    assert.deepEqual(calls, ["search"]);
});

test("clicking the 'For you' tab while 'search' is active calls onChange('for-you') exactly once", () => {
    const calls: JobsHomeView[] = [];
    const buttons = tabButtons("search", (v) => calls.push(v));
    const forYouTab = buttons.find((b) => b.key === "for-you")!;
    (forYouTab.props as { onClick: () => void }).onClick();
    assert.deepEqual(calls, ["for-you"]);
});

test("clicking the already-active tab still calls onChange with its own value (idempotent, not a no-op guard)", () => {
    const calls: JobsHomeView[] = [];
    const buttons = tabButtons("for-you", (v) => calls.push(v));
    const forYouTab = buttons.find((b) => b.key === "for-you")!;
    (forYouTab.props as { onClick: () => void }).onClick();
    assert.deepEqual(calls, ["for-you"]);
});

test("aria-selected marks exactly the active tab, for either value", () => {
    const forYouActive = renderToStaticMarkup(React.createElement(ForYouToggle, { value: "for-you", onChange: () => {} }));
    assert.match(forYouActive, /For you · résumé<\/button>/);
    const searchActiveHtml = renderToStaticMarkup(React.createElement(ForYouToggle, { value: "search", onChange: () => {} }));
    const selectedTrue = searchActiveHtml.match(/aria-selected="true"[^>]*>([^<]*)</);
    assert.equal(selectedTrue?.[1], "Search all jobs");
    const forYouSelected = forYouActive.match(/aria-selected="true"[^>]*>([^<]*)</);
    assert.equal(forYouSelected?.[1], "For you · résumé");
});
