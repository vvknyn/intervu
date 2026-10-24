import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planGuestSync } from "../../src/lib/pursuits/guest-sync-plan";

describe("planGuestSync", () => {
    const manual = { id: "m", job_id: undefined };
    const linked = { id: "j", job_id: "job1" };
    it("removes rows the server confirmed that hold no copy", () => {
        const plan = planGuestSync([{ guest: manual, serverId: "s1", copyHeld: false }, { guest: linked, serverId: "s2", copyHeld: false }]);
        assert.deepEqual([...plan.remove].sort(), ["j", "m"]);
        assert.equal(plan.rekey.size, 0);
    });
    it("keeps a manual row holding a copy, keyed to its new server id", () => {
        const plan = planGuestSync([{ guest: manual, serverId: "s1", copyHeld: true }]);
        assert.equal(plan.remove.size, 0);
        assert.deepEqual([...plan.rekey], [["m", "s1"]]);
    });
    it("keeps a job-linked row holding a copy (idempotent re-sync), without rekeying", () => {
        const plan = planGuestSync([{ guest: linked, serverId: "s2", copyHeld: true }]);
        assert.equal(plan.remove.size, 0);
        assert.equal(plan.rekey.size, 0);
    });
    it("touches nothing the server did not confirm", () => {
        const plan = planGuestSync([{ guest: manual, serverId: null, copyHeld: true }, { guest: linked, serverId: null, copyHeld: false }]);
        assert.equal(plan.remove.size + plan.rekey.size, 0);
    });
});
