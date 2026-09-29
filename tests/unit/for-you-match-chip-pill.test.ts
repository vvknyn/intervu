import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchChip } from "../../src/components/jobs/MatchChip";
import { MATCH_BAND_STRONG_MIN, type MatchScore } from "../../src/lib/match/score";

/**
 * For-you's row fit pill (mock B5) is `JobCard`'s existing `matchScore` prop
 * rendering `MatchChip` — the SAME chip Search's row already uses, not a
 * new For-you-only pill. This asserts the pill's qualitative label comes
 * from the scored total via `matchBand`, for more than one value, so the
 * pill can never drift from what actually got computed.
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

test("pill renders Good for a mid-band total, not a hardcoded number", () => {
    const html = renderToStaticMarkup(React.createElement(MatchChip, { score: score(62) }));
    assert.equal(chipText(html), "Good");
});

test("pill renders Strong for a high-band total — class-wide, not the one instance that motivated it", () => {
    const html = renderToStaticMarkup(React.createElement(MatchChip, { score: score(91) }));
    assert.equal(chipText(html), "Strong");
});

test("pill renders Stretch below the Good band", () => {
    const html = renderToStaticMarkup(React.createElement(MatchChip, { score: score(45) }));
    assert.equal(chipText(html), "Stretch");
});

// 866cf122 mapped match bands to verdict tints: Strong's brand outline became the live tint.
test("live-tint styling switches at the Strong band, driven by the score, not a copy of the constant", () => {
    const below = renderToStaticMarkup(
        React.createElement(MatchChip, { score: score(MATCH_BAND_STRONG_MIN - 1) }),
    );
    const atThreshold = renderToStaticMarkup(
        React.createElement(MatchChip, { score: score(MATCH_BAND_STRONG_MIN) }),
    );
    assert.doesNotMatch(below, /border-live-tint-border/);
    assert.match(atThreshold, /border-live-tint-border/);
});
