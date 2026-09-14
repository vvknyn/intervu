import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    fallbackActiveId,
    findActiveIndexById,
    nextActiveIdAfterSkip,
} from "../../src/lib/jobs/for-you/deck-active-job";

function jobs(ids: string[]) {
    return ids.map((id) => ({ id }));
}

describe("findActiveIndexById", () => {
    it("keeps the same job active across a re-sort (order changes, id doesn't)", () => {
        const before = jobs(["a", "b", "c", "d"]);
        const activeId = before[1].id; // "b", at index 1
        const afterResort = jobs(["d", "b", "a", "c"]); // async match-score re-sort
        assert.equal(findActiveIndexById(before, activeId), 1);
        assert.equal(findActiveIndexById(afterResort, activeId), 1);
        assert.equal(afterResort[findActiveIndexById(afterResort, activeId)].id, "b");
    });

    it("still finds the job in a filtered (shorter) list that still contains it", () => {
        const full = jobs(["a", "b", "c", "d", "e"]);
        const activeId = full[3].id; // "d"
        const filtered = jobs(["b", "d", "e"]); // a Search filter dropped a/c
        assert.equal(findActiveIndexById(filtered, activeId), 1);
    });

    it("returns -1 when the job is gone (list replaced) rather than guessing a position", () => {
        const replaced = jobs(["x", "y", "z"]);
        assert.equal(findActiveIndexById(replaced, "b"), -1);
    });

    it("returns -1 for a null id (nothing active yet)", () => {
        assert.equal(findActiveIndexById(jobs(["a", "b"]), null), -1);
    });
});

describe("fallbackActiveId", () => {
    it("picks the first card when the active job is gone for a reason other than a skip", () => {
        const replaced = jobs(["x", "y", "z"]);
        assert.equal(fallbackActiveId(replaced), "x");
    });

    it("is null for an empty deck", () => {
        assert.equal(fallbackActiveId([]), null);
    });
});

describe("nextActiveIdAfterSkip", () => {
    it("advances exactly one card: the job that slides into the skipped card's slot", () => {
        const remaining = jobs(["a", "c", "d"]); // "b" (index 1) was just skipped
        assert.equal(nextActiveIdAfterSkip(remaining, 1), "c");
    });

    it("advances exactly one card on the last card of the deck (clamps, doesn't overshoot)", () => {
        const remaining = jobs(["a", "b", "c"]); // the 4th and last card was skipped
        assert.equal(nextActiveIdAfterSkip(remaining, 3), "c");
    });

    it("is null when skipping the only remaining card empties the deck", () => {
        assert.equal(nextActiveIdAfterSkip([], 0), null);
    });
});
