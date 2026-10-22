import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { toast, startToastTimer, getToastItems, hasPendingToasts, dismissToast } from "../../src/lib/toast-store";

const timers: Array<{ fn: () => void; ms: number }> = [];
(globalThis as any).window = { setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return 0; } };

beforeEach(() => {
    timers.length = 0;
    for (const t of [...getToastItems()]) dismissToast(t.id);
});

for (const [kind, ms] of [["success", 3500], ["info", 3500], ["error", 5000]] as const) {
    test(`a ${kind} toast pushed before the Toaster mounts stays alive with no timer`, () => {
        toast[kind]("early");
        assert.equal(hasPendingToasts(), true);
        assert.equal(timers.length, 0);
        assert.equal(getToastItems().length, 1);
    });

    test(`a ${kind} toast's timer starts once, on first render, and dismisses it`, () => {
        const id = toast[kind]("early");
        startToastTimer(id);
        startToastTimer(id);
        assert.equal(timers.length, 1);
        assert.equal(timers[0].ms, ms);
        timers[0].fn();
        assert.equal(hasPendingToasts(), false);
    });
}
