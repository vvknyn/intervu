import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jobTrackRecord, pairedKpiChips } from "@/components/jobs/job-detail-facts";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * Defect [1] (launch-consistency sweep, 2026-09): the employer rail's
 * "opened / closed, 90d" KPI used to join both numbers with a slash —
 * "6/5" — which reads as a fraction or a rating on every job detail view.
 * These tests cover the RENDER SHAPE fix (two independent chips, never a
 * joined string) with values other than the instance that surfaced the bug,
 * including the 0/0 edge case and the "one side missing" gate.
 */

const base: Partial<PublicJob> = { company_opened_90d: null, company_closed_90d: null };

describe("pairedKpiChips", () => {
    it("renders two independent chips, never a slash-joined fraction", () => {
        const chips = pairedKpiChips({ opened90d: 14, closed90d: 3 });
        assert.deepEqual(chips, [
            { value: "14", label: "Opened, 90d" },
            { value: "3", label: "Closed, 90d" },
        ]);
        for (const chip of chips) {
            assert.equal(chip.value.includes("/"), false, `chip value "${chip.value}" must never contain a "/" — that is the fraction-look bug`);
        }
    });

    it("renders an honest 0/0 pair, not a suppressed or fabricated value", () => {
        const chips = pairedKpiChips({ opened90d: 0, closed90d: 0 });
        assert.deepEqual(chips, [
            { value: "0", label: "Opened, 90d" },
            { value: "0", label: "Closed, 90d" },
        ]);
    });

    it("formats large counts with locale grouping, same as every other KPI in the rail", () => {
        const chips = pairedKpiChips({ opened90d: 1234, closed90d: 56 });
        assert.equal(chips[0]!.value, (1234).toLocaleString());
        assert.equal(chips[1]!.value, (56).toLocaleString());
    });
});

describe("jobTrackRecord — half a history is not a track record", () => {
    it("returns null when both halves are missing", () => {
        assert.equal(jobTrackRecord(base as PublicJob), null);
    });

    it("returns null when only opened_90d is present (closed missing)", () => {
        assert.equal(jobTrackRecord({ ...base, company_opened_90d: 14 } as PublicJob), null);
    });

    it("returns null when only closed_90d is present (opened missing) — the other missing-side case", () => {
        assert.equal(jobTrackRecord({ ...base, company_closed_90d: 3 } as PublicJob), null);
    });

    it("returns the pair only when both halves are present together", () => {
        assert.deepEqual(jobTrackRecord({ ...base, company_opened_90d: 14, company_closed_90d: 3 } as PublicJob), {
            opened90d: 14,
            closed90d: 3,
        });
    });
});
