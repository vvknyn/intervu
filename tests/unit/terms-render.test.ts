import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("/terms", () => {
  it("renders no data sale or licensing terms", async () => {
    // The page module reads the site origin at import time.
    process.env.NEXT_PUBLIC_SITE_URL ??= "https://example.test";
    const { default: TermsPage } = await import("../../src/app/terms/page");
    const html = renderToStaticMarkup(React.createElement(TermsPage));
    assert.match(html, /Pricing and refunds/);
    assert.match(html, /1 to 12 months/);
    assert.match(html, /never renews on its own/);
    assert.match(html, /refund within 14 days/);
    assert.doesNotMatch(html, /founding/i);
    assert.doesNotMatch(html, /Data API|licens/i);
  });
});
