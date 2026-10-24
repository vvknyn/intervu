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
    assert.match(html, /Pricing and the founding offer/);
    assert.doesNotMatch(html, /Data API|licens/i);
  });
});
