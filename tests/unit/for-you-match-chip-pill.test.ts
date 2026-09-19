import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchChip } from "../../src/components/jobs/MatchChip";
import { MATCH_CHIP_BRAND_THRESHOLD, type MatchScore } from "../../src/lib/match/score";

/**
 * For-you's row fit pill (mock B5) is `JobCard`'s existing `matchScore` prop
 * rendering `MatchChip` — the SAME chip Search's row already uses, not a
 * new For-you-only pill. This asserts the pill's label/value come straight
 * from `score.total` (the existing scored field), for more than one value,
 * so the pill can never drift from what actually got computed.
 */
function score(total: number): MatchScore {
    return {
        total,
        components: [{ key: "relevance", label: "Relevance", detail: "7 of 12 terms this role names", score: 0.6 }],
    };
}

function chipText(html: string): string {
    const m = html.match(/data-testid="match-chip"[^>]*>([\s\S]*?)<\/span>/);
    assert.ok(m, "expected a data-testid=\"match-chip\" element");
    return m![1].trim();
}

test("pill renders 'match <total>' for the scored total, not a hardcoded number", () => {
    const html = renderToStaticMarkup(React.createElement(MatchChip, { score: score(62) }));
    assert.equal(chipText(html), "match 62");
});

test("pill tracks a different total too — class-wide, not the one instance that motivated it", () => {
    const html = renderToStaticMarkup(React.createElement(MatchChip, { score: score(91) }));
    assert.equal(chipText(html), "match 91");
});

test("brand-outline styling switches at MATCH_CHIP_BRAND_THRESHOLD, driven by the field, not a copy of the constant", () => {
    const below = renderToStaticMarkup(
        React.createElement(MatchChip, { score: score(MATCH_CHIP_BRAND_THRESHOLD - 1) }),
    );
    const atThreshold = renderToStaticMarkup(
        React.createElement(MatchChip, { score: score(MATCH_CHIP_BRAND_THRESHOLD) }),
    );
    assert.doesNotMatch(below, /border-brand/);
    assert.match(atThreshold, /border-brand/);
});
