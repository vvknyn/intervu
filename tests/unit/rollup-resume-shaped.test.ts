import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aggregateDailyMetrics, impressionVolumeByDay } from "@/lib/telemetry/daily-rollup";
import { fetchWindowImpressionCounts, toImpressionEventRows } from "@/lib/telemetry/rollup-fetch";
import type { Queryable } from "@/lib/pg/pool";

const DAY = "2026-10-25";

describe("rollup with résumé-shaped results_impressed", () => {
  it("counts a shaped row in volume but feeds nothing to per-job or position inputs", async () => {
    // Ledger rows: shaped (count 7, no job_ids) and plain (count 2, with ids).
    const db: Queryable = {
      query: async <R>() =>
        ({
          rows: [
            { day: DAY, count: "7", positioned: false },
            { day: DAY, count: "2", positioned: true },
          ] as R[],
        }),
    };
    const volume = impressionVolumeByDay(await fetchWindowImpressionCounts(db, 2));
    assert.deepEqual(volume.get(DAY), { total: 9, positioned: 2 });

    // The unnest reader yields rows only for the plain event (shaped: none).
    const unnested = toImpressionEventRows([
      { day: DAY, job_id: "a", position: 1 },
      { day: DAY, job_id: "b", position: 2 },
    ]);
    const perJob = aggregateDailyMetrics(unnested, (e) => e.job_id);
    assert.equal(perJob.get(`a|${DAY}`)?.impressions, 1);
    assert.equal(perJob.size, 2);
    for (const m of perJob.values()) assert.notEqual(m.mean_position, 0);
  });

  it("a day with only shaped rows has volume and positioned 0, never a fabricated position", () => {
    const v = impressionVolumeByDay([{ day: DAY, count: 5, positioned: false }]);
    assert.deepEqual(v.get(DAY), { total: 5, positioned: 0 });
    assert.equal(aggregateDailyMetrics([], (e) => e.job_id).size, 0);
  });
});
