import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ScoredHubHit } from "@/lib/jobs/for-you/hub-counts";
import {
    chipCountsToRemember,
    exactHubCounts,
    hubCountsGate,
    resolveHubCountDeltas,
    type HubCountsGate,
    type HubPackCounts,
    type HubProbeRead,
    type HubTileCountMemory,
} from "@/lib/jobs/for-you/hub-count-deltas";
import { TODAY_SESSION_GAP_MS } from "@/lib/jobs/for-you/today";
import type { MatchScore } from "@/lib/match/score";
import { mkJob } from "../support/jobs-corpus-stub";

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

describe("exactHubCounts", () => {
    it("keeps only exact counts: a floor from the keyword sample never compares", () => {
        assert.deepEqual(
            exactHubCounts({ all: { kind: "exact", value: 508 }, ai: { kind: "floor", value: 31 }, remote: null, fresh: undefined }),
            { all: 508 },
        );
    });
});

describe("hubCountsGate: a visit's counts are remembered when the probe and the tracker are both in, whichever comes last", () => {
    // What a probe read, told apart by its pack's search total.
    const read = (poolTotal: number): HubProbeRead => ({ scored: [], poolTotal, tiles: { fresh: null, salary: [] } });

    it("the tracker first: the counts are remembered the moment the probe settles", () => {
        const seen: HubProbeRead[] = [];
        const gate = hubCountsGate<HubProbeRead>((value) => seen.push(value), true);
        const r = read(1);
        gate.settled(r);
        assert.deepEqual(seen, [r]);
    });

    it("the tracker last: nothing is remembered at the probe, and the tracker's arrival remembers what the probe read", () => {
        const seen: HubProbeRead[] = [];
        const gate = hubCountsGate<HubProbeRead>((value) => seen.push(value), false);
        const r = read(1);
        gate.settled(r);
        assert.deepEqual(seen, [], "the tracker has not loaded: the counts would still hold the roles applied to");
        gate.tracker(true);
        assert.deepEqual(seen, [r]);
    });

    it("a tracker that loads before the probe has anything to remember remembers nothing yet", () => {
        const seen: HubProbeRead[] = [];
        const gate = hubCountsGate<HubProbeRead>((value) => seen.push(value), false);
        gate.tracker(true);
        assert.deepEqual(seen, []);
        gate.settled(read(1));
        assert.equal(seen.length, 1);
    });

    it("a tracker loading again holds the counts until it is back, and a visit is remembered once", () => {
        const seen: HubProbeRead[] = [];
        const gate = hubCountsGate<HubProbeRead>((value) => seen.push(value), true);
        gate.tracker(false);
        gate.settled(read(1));
        assert.deepEqual(seen, []);
        gate.tracker(true);
        gate.tracker(false);
        gate.tracker(true);
        gate.settled(read(2));
        assert.equal(seen.length, 1);
    });

    it("a newer probe's gate takes over: the one it replaced remembers nothing", () => {
        const seen: HubProbeRead[] = [];
        const gate: HubCountsGate<HubProbeRead> = hubCountsGate<HubProbeRead>((value) => seen.push(value), false);
        gate.settled(read(1));
        gate.cancel();
        gate.tracker(true);
        gate.settled(read(2));
        assert.deepEqual(seen, []);
    });
});

describe("the counts a visit remembers are the same whichever of the probe and the tracker finishes last", () => {
    const NOW_MS = Date.UTC(2026, 9, 16, 15, 0);
    const strong: MatchScore = { total: 88, components: [], role: "own" };
    const hit = (id: string): ScoredHubHit => ({
        job: mkJob(id, { title: "Product Manager", company: `Co ${id}`, posted_at: new Date(NOW_MS - 3 * DAY).toISOString() }),
        score: strong,
    });
    // The pack's search found 4 and read 4; the account has already applied to role "a".
    const probe = (ids: string[]): HubProbeRead => ({ scored: ids.map(hit), poolTotal: ids.length, tiles: { fresh: ids.map(hit), salary: [] } });
    const tracked = new Set(["a"]);

    // One device's storage across visits, and one visit with the tracker answering `trackerFirst` or after the probe.
    function visit(device: { memory: HubTileCountMemory | null }, ids: string[], trackerFirst: boolean, nowMs: number): HubPackCounts {
        const before = device.memory;
        let deltas: HubPackCounts = {};
        const gate = hubCountsGate<HubProbeRead>(
            (value) => {
                const counts = chipCountsToRemember({ ...value, industry: "tech", isTracked: (job) => tracked.has(job.id), nowMs });
                const resolved = resolveHubCountDeltas(device.memory, "résumé\0pack", counts, nowMs);
                device.memory = resolved.next;
                deltas = resolved.deltas;
            },
            trackerFirst,
        );
        gate.settled(probe(ids));
        if (!trackerFirst) {
            assert.equal(device.memory, before, "nothing is written before the tracker is");
            gate.tracker(true);
        }
        return deltas;
    }

    it("remembers the same counts, leaving out the role applied to, and the next visit says what each pack gained", () => {
        const early = { memory: null as HubTileCountMemory | null };
        const late = { memory: null as HubTileCountMemory | null };
        visit(early, ["a", "b", "c", "d"], true, NOW_MS);
        visit(late, ["a", "b", "c", "d"], false, NOW_MS);
        assert.ok(early.memory, "the tracker first: the visit is remembered");
        assert.ok(late.memory, "the tracker last: the visit is remembered too");
        assert.deepEqual(late.memory, early.memory);
        assert.equal(late.memory.counts.all, 3, "four roles read, one already applied to");

        // Two days later the pack lists 3 more roles: the chip says "+3", whichever finished last on either visit.
        const gained = ["a", "b", "c", "d", "e", "f", "g"];
        assert.deepEqual(visit(early, gained, true, NOW_MS + 2 * DAY).all, 3);
        assert.deepEqual(visit(late, gained, false, NOW_MS + 2 * DAY).all, 3);
    });
});
