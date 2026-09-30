import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hubChipCountText } from "@/lib/jobs/for-you/hub-counts";
import { exactHubCounts, resolveHubCountDeltas, type HubTileCountMemory } from "@/lib/jobs/for-you/hub-count-deltas";
import { TODAY_SESSION_GAP_MS } from "@/lib/jobs/for-you/today";

const NOW = Date.UTC(2026, 8, 29, 15, 0);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("resolveHubCountDeltas", () => {
    it("a first visit shows no deltas and remembers the counts", () => {
        const { deltas, next } = resolveHubCountDeltas(null, "k", { all: 500, remote: 90 }, NOW);
        assert.deepEqual(deltas, {});
        assert.deepEqual(next, { key: "k", lastAt: iso(NOW), counts: { all: 500, remote: 90 }, since: null });
    });

    it("a later visit shows what each pack gained since the last one, never a shrink", () => {
        const memory: HubTileCountMemory = { key: "k", lastAt: iso(NOW - 2 * DAY), counts: { all: 494, remote: 95, salary: 88 }, since: null };
        const { deltas, next } = resolveHubCountDeltas(memory, "k", { all: 508, remote: 90, salary: 93, fresh: 140 }, NOW);
        assert.deepEqual(deltas, { all: 14, salary: 5 });
        assert.deepEqual(next.since, { at: memory.lastAt, counts: memory.counts });
    });

    it("going into a pack and back in the same sitting keeps the sitting's deltas", () => {
        const first = resolveHubCountDeltas(
            { key: "k", lastAt: iso(NOW - 2 * DAY), counts: { all: 494 }, since: null },
            "k",
            { all: 508 },
            NOW,
        );
        const back = resolveHubCountDeltas(first.next, "k", { all: 508 }, NOW + TODAY_SESSION_GAP_MS - 1);
        assert.deepEqual(back.deltas, { all: 14 });
    });

    it("counts read for another résumé or pack never make a delta", () => {
        const memory: HubTileCountMemory = { key: "old", lastAt: iso(NOW - 2 * DAY), counts: { all: 10 }, since: null };
        const { deltas, next } = resolveHubCountDeltas(memory, "new", { all: 500 }, NOW);
        assert.deepEqual(deltas, {});
        assert.equal(next.since, null);
    });
});

describe("exactHubCounts and hubChipCountText", () => {
    it("keeps only exact counts: a floor from the keyword sample never compares", () => {
        assert.deepEqual(
            exactHubCounts({ all: { kind: "exact", value: 508 }, ai: { kind: "floor", value: 31 }, remote: null, fresh: undefined }),
            { all: 508 },
        );
    });

    it("a chip shows the pill's number without its noun", () => {
        assert.equal(hubChipCountText("1,508 roles"), "1,508");
        assert.equal(hubChipCountText("1 role"), "1");
        assert.equal(hubChipCountText("31+ roles"), "31+");
        assert.equal(hubChipCountText("…"), "…");
    });
});
