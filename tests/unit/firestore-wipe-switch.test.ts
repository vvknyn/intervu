import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dropDeletedSinceSwitch, type FirestoreInventory, type TableCheck } from "../../scripts/lib/firestore-exit";

const T = "2026-10-09T15:48:53.950Z";

function check(missing: string[]): TableCheck {
    return { collection: "followedCompanies", firestore: 8, postgres: 7, unsealed: 0, missing, extra: 0 };
}

const inv: FirestoreInventory = {
    known: new Map([
        [
            "followedCompanies",
            [
                { path: "users/u1/followedCompanies/stripe.com", data: {}, updatedAt: "2026-10-01T00:00:00.000Z" },
                { path: "users/u2/followedCompanies/acme.com", data: {}, updatedAt: "2026-10-09T16:00:00.000Z" },
                { path: "users/u3/followedCompanies/none.com", data: {} },
            ],
        ],
    ]),
    legacy: [],
    roots: ["users"],
};

describe("dropDeletedSinceSwitch", () => {
    it("lets through a copy last written before the switch, which the site has since removed", () => {
        const [c] = dropDeletedSinceSwitch([check(["users/u1/followedCompanies/stripe.com"])], inv, T, () => {});
        assert.deepEqual(c.missing, []);
    });

    it("still blocks on anything written after the switch or with no known write time", () => {
        const missing = ["users/u2/followedCompanies/acme.com", "users/u3/followedCompanies/none.com", "2 legacy documents"];
        const [c] = dropDeletedSinceSwitch([check(missing)], inv, T, () => {});
        assert.deepEqual(c.missing, missing);
    });
});
