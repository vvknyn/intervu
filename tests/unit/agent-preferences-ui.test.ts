import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeCustomAnswersPatch } from "../../src/components/settings/AgentPreferencesSection";

interface CustomRow {
    id: number;
    key: string;
    value: string;
}

describe("computeCustomAnswersPatch", () => {
    it("rows with new keys not in loadedKeys each become {key: value}, nothing marked for deletion", () => {
        const rows: CustomRow[] = [
            { id: 1, key: "visa", value: "no sponsorship needed" },
            { id: 2, key: "clearance", value: "none" },
        ];
        const out = computeCustomAnswersPatch(rows, new Set());
        assert.deepEqual(out, { visa: "no sponsorship needed", clearance: "none" });
    });

    it("a loadedKey with no matching current row becomes {key: null}", () => {
        const out = computeCustomAnswersPatch([], new Set(["visa"]));
        assert.deepEqual(out, { visa: null });
    });

    it("adding one new key and deleting one existing key in the same call does both, leaving an untouched loaded key at its current value", () => {
        const rows: CustomRow[] = [
            { id: 1, key: "clearance", value: "none" },
            { id: 2, key: "salary_history", value: "not disclosed" },
        ];
        const out = computeCustomAnswersPatch(rows, new Set(["visa", "clearance"]));
        assert.deepEqual(out, {
            salary_history: "not disclosed",
            clearance: "none",
            visa: null,
        });
    });

    it("a row with a blank/whitespace-only key is skipped entirely, contributing nothing", () => {
        const rows: CustomRow[] = [
            { id: 1, key: "   ", value: "should not appear" },
            { id: 2, key: "", value: "also should not appear" },
            { id: 3, key: "visa", value: "no sponsorship needed" },
        ];
        const out = computeCustomAnswersPatch(rows, new Set());
        assert.deepEqual(out, { visa: "no sponsorship needed" });
        assert.equal(Object.prototype.hasOwnProperty.call(out, ""), false);
    });

    it("an unchanged row (loaded and current, same value) still sends its current value, not omitted as a no-op", () => {
        const rows: CustomRow[] = [{ id: 1, key: "visa", value: "no sponsorship needed" }];
        const out = computeCustomAnswersPatch(rows, new Set(["visa"]));
        assert.deepEqual(out, { visa: "no sponsorship needed" });
    });

    it("keys are matched by the TRIMMED key value: a padded row key matches an untrimmed loadedKeys entry, so it is treated as the same key (kept, not also nulled)", () => {
        const rows: CustomRow[] = [{ id: 1, key: "  visa  ", value: "no sponsorship needed" }];
        const out = computeCustomAnswersPatch(rows, new Set(["visa"]));
        assert.deepEqual(out, { visa: "no sponsorship needed" });
    });
});
