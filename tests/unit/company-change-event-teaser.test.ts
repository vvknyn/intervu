import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyChangeEventTeaser } from "../../src/components/company/CompanyChangeEventTeaser";
import type { CompanyChangeEvent } from "../../src/lib/companies/types";

function event(partial: Partial<CompanyChangeEvent> = {}): CompanyChangeEvent {
  return {
    event_type: "hiring_freeze",
    direction: "declining",
    headline: "hiring has stalled: 167 new roles in 14d, down from 485",
    occurred_at: "2026-08-16T09:00:00Z",
    confidence: 0.82,
    ...partial,
  };
}

describe("CompanyChangeEventTeaser", () => {
  it("renders the newest event headline with its type chip", () => {
    const html = renderToStaticMarkup(
      React.createElement(CompanyChangeEventTeaser, { event: event() }),
    );
    assert.match(html, /data-testid="company-change-event-teaser"/);
    assert.match(html, /Hiring freeze/);
    assert.match(html, /hiring has stalled: 167 new roles in 14d, down from 485/);
    assert.match(html, /Aug 16, 2026/);
  });

  it("renders nothing when there is no event", () => {
    const html = renderToStaticMarkup(
      React.createElement(CompanyChangeEventTeaser, { event: null }),
    );
    assert.equal(html, "");
  });
});
