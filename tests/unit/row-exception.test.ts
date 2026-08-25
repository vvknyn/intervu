import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rowExceptionMark } from "../../src/lib/jobs/row-exception";
import { GHOST_META } from "../../src/lib/jobs/presentation";
import { RELISTED_EXPLAIN } from "../../src/lib/jobs/relisted-explain";
import { LISTING_STATE_TEXT } from "../../src/lib/ui/status-tokens";
import type { RowExceptionJob } from "../../src/lib/jobs/row-exception";

const NOW = Date.parse("2026-08-24T12:00:00Z");

function job(overrides: Partial<RowExceptionJob> = {}): RowExceptionJob {
    return {
        ghost_badge: "clear",
        ghost_checked_at: new Date(NOW - 86_400_000).toISOString(),
        posted_at: new Date(NOW - 5 * 86_400_000).toISOString(),
        first_seen_at: new Date(NOW - 30 * 86_400_000).toISOString(),
        ...overrides,
    };
}

describe("rowExceptionMark", () => {
    it("both wins when likely_ghost and relisted", () => {
        const mark = rowExceptionMark(
            job({
                ghost_badge: "likely_ghost",
                posted_at: new Date(NOW - 2 * 86_400_000).toISOString(),
                first_seen_at: new Date(NOW - 20 * 86_400_000).toISOString(),
            }),
            NOW,
        );
        assert.ok(mark);
        assert.equal(mark!.kind, "both");
        assert.equal(mark!.parts.length, 2);
        assert.equal(mark!.parts[0]!.text, "Relisted");
        assert.equal(mark!.parts[0]!.className, LISTING_STATE_TEXT.relisted);
        assert.equal(mark!.parts[1]!.text, GHOST_META.likely_ghost!.label);
        assert.equal(mark!.parts[1]!.className, "text-st-closed");
        assert.match(mark!.explain, new RegExp(RELISTED_EXPLAIN.slice(0, 20)));
        assert.match(mark!.explain, /may no longer be live/i);
    });

    it("stale alone when likely_ghost without relist gap", () => {
        const mark = rowExceptionMark(
            job({
                ghost_badge: "likely_ghost",
                posted_at: new Date(NOW - 10 * 86_400_000).toISOString(),
                first_seen_at: new Date(NOW - 11 * 86_400_000).toISOString(),
            }),
            NOW,
        );
        assert.ok(mark);
        assert.equal(mark!.kind, "stale");
        assert.deepEqual(mark!.parts, [{ text: "Possibly stale", className: "text-st-closed" }]);
    });

    it("relisted alone when clear badge with relist gap", () => {
        const mark = rowExceptionMark(
            job({
                ghost_badge: "clear",
                posted_at: new Date(NOW - 2 * 86_400_000).toISOString(),
                first_seen_at: new Date(NOW - 20 * 86_400_000).toISOString(),
            }),
            NOW,
        );
        assert.ok(mark);
        assert.equal(mark!.kind, "relisted");
        assert.equal(mark!.parts[0]!.text, "Relisted");
        assert.equal(mark!.explain, RELISTED_EXPLAIN);
    });

    it("review when caution and no relist", () => {
        const mark = rowExceptionMark(
            job({
                ghost_badge: "caution",
                posted_at: new Date(NOW - 10 * 86_400_000).toISOString(),
                first_seen_at: new Date(NOW - 11 * 86_400_000).toISOString(),
            }),
            NOW,
        );
        assert.ok(mark);
        assert.equal(mark!.kind, "review");
        assert.equal(mark!.parts[0]!.text, GHOST_META.caution!.label);
        assert.equal(mark!.parts[0]!.className, "text-st-intv");
    });

    it("unmarked for clear without relist", () => {
        assert.equal(
            rowExceptionMark(
                job({
                    ghost_badge: "clear",
                    posted_at: new Date(NOW - 10 * 86_400_000).toISOString(),
                    first_seen_at: new Date(NOW - 11 * 86_400_000).toISOString(),
                }),
                NOW,
            ),
            null,
        );
    });

    it("clear + relisted is relisted, not both", () => {
        const mark = rowExceptionMark(
            job({
                ghost_badge: "clear",
                posted_at: new Date(NOW - 2 * 86_400_000).toISOString(),
                first_seen_at: new Date(NOW - 20 * 86_400_000).toISOString(),
            }),
            NOW,
        );
        assert.ok(mark);
        assert.equal(mark!.kind, "relisted");
        assert.notEqual(mark!.kind, "both");
    });
});
