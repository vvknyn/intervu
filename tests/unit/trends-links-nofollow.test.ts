import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrendLink } from "@/components/trends/TrendLink";
import { BarRow } from "@/components/trends/TrendSection";

describe("/trends links into /jobs search", () => {
  it("TrendLink is nofollow", () => {
    const html = renderToStaticMarkup(React.createElement(TrendLink, { href: "/?country=Canada" }, "Canada"));
    assert.match(html, /rel="nofollow"/);
  });

  it("a linked trend row is nofollow, an unlinked one has no anchor", () => {
    const linked = renderToStaticMarkup(
      React.createElement(BarRow, { label: "Remote", count: 3, max: 5, href: "/?work=remote" } as never),
    );
    assert.match(linked, /<a [^>]*rel="nofollow"/);
    const quiet = renderToStaticMarkup(React.createElement(BarRow, { label: "Hybrid", count: 1, max: 5 } as never));
    assert.doesNotMatch(quiet, /<a /);
  });
});
