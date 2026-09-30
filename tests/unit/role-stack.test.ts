import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { poseForOffset, roleStackEntries } from "../../src/lib/jobs/for-you/role-stack";

const roles = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));
const view = (entries: ReturnType<typeof roleStackEntries<{ id: string }>>) =>
    entries.map((entry) => `${entry.key}:${entry.pose}`);

describe("role stack", () => {
    it("poses a card by its distance from the open role", () => {
        assert.equal(poseForOffset(0), "front");
        assert.equal(poseForOffset(1), "upcoming");
        assert.equal(poseForOffset(-1), "behind-1");
        assert.equal(poseForOffset(-2), "behind-2");
        assert.equal(poseForOffset(-3), "gone");
    });

    it("keeps three roles behind the open one and one ahead, in list order", () => {
        assert.deepEqual(view(roleStackEntries(roles, 4)), [
            "b:gone",
            "c:behind-2",
            "d:behind-1",
            "e:front",
            "f:upcoming",
        ]);
        assert.deepEqual(view(roleStackEntries(roles, 0)), ["a:front", "b:upcoming"]);
        assert.deepEqual(view(roleStackEntries(roles, 6)), ["d:gone", "e:behind-2", "f:behind-1", "g:front"]);
    });

    it("clamps an index past either end instead of showing an empty stage", () => {
        assert.deepEqual(view(roleStackEntries(roles, 99)), view(roleStackEntries(roles, 6)));
        assert.deepEqual(view(roleStackEntries(roles, -2)), view(roleStackEntries(roles, 0)));
        assert.deepEqual(roleStackEntries([], 0), []);
    });

    it("Next and Previous only add or drop cards at the ends, so no card changes order", () => {
        for (let active = 0; active < roles.length - 1; active++) {
            const before = roleStackEntries(roles, active).map((entry) => entry.key);
            const after = roleStackEntries(roles, active + 1).map((entry) => entry.key);
            const kept = after.filter((key) => before.includes(key));
            assert.deepEqual(kept, before.filter((key) => after.includes(key)), `order changed at ${active}`);
        }
    });

    it("a skipped role stays where it was, under the role that replaced it", () => {
        // "c" was open; Skip removed it and "d" slid into its slot.
        const remaining = roles.filter((role) => role.id !== "c");
        const entries = roleStackEntries(remaining, 2, { departing: { id: "c" } });
        assert.deepEqual(view(entries), ["a:behind-2", "b:behind-1", "c:departing", "d:front", "e:upcoming"]);
        const before = roleStackEntries(roles, 2).map((entry) => entry.key);
        const kept = entries.map((entry) => entry.key).filter((key) => before.includes(key));
        assert.deepEqual(kept, before.filter((key) => kept.includes(key)));
    });

    it("marks exactly the open role active, even while it waits below the stage", () => {
        for (const entered of [true, false]) {
            const active = roleStackEntries(roles, 3, { entered, departing: { id: "x" } }).filter((entry) => entry.active);
            assert.deepEqual(active.map((entry) => entry.key), ["d"]);
        }
    });

    it("ignores a departing role that is still in the list", () => {
        assert.deepEqual(view(roleStackEntries(roles, 1, { departing: { id: "b" } })), view(roleStackEntries(roles, 1)));
    });

    it("the first frame holds the open role below the stage so it slides up on open", () => {
        assert.deepEqual(view(roleStackEntries(roles, 2, { entered: false })), [
            "a:behind-2",
            "b:behind-1",
            "c:upcoming",
            "d:upcoming",
        ]);
    });
});
