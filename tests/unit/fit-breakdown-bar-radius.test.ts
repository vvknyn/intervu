import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgressBar } from "../../src/components/ui/progress-bar";

test("ProgressBar with radius=\"ctl\" and partial progress uses rounded-ctl on track and fill", () => {
    const html = renderToStaticMarkup(
        React.createElement(ProgressBar, { progress: 75, radius: "ctl" }),
    );
    const ctlCount = (html.match(/rounded-ctl/g) ?? []).length;
    assert.ok(ctlCount >= 2, `expected rounded-ctl on track and fill, found ${ctlCount}`);
    assert.doesNotMatch(html, /rounded-pill/);
    assert.doesNotMatch(html, /rounded-none/);
});

test("ProgressBar default (no radius prop) keeps rounded-pill and no rounded-ctl", () => {
    const html = renderToStaticMarkup(React.createElement(ProgressBar, { progress: 50 }));
    assert.match(html, /rounded-pill/);
    assert.doesNotMatch(html, /rounded-ctl/);
});
