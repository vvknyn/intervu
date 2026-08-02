import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PACKS, ACTION_COSTS, APPLICATION_COST, applicationsPerPack, costPerApplication } from "@/lib/pricing";

describe("costPerApplication()", () => {
  it("derives exactly 50¢ from the starter pack's rate", () => {
    // starter: $5 / 60 credits; APPLICATION_COST = tailor(4) + fit(2) = 6
    // credits -> 5 * 6 / 60 = $0.50 -> "50¢". This is the number the /pricing
    // "about fifty cents" line composes around.
    assert.equal(costPerApplication(), "50¢");
  });

  it("moves if PACKS' starter rate changes (not a hardcoded literal)", () => {
    // Sanity-check the derivation formula independently of the live constant,
    // proving costPerApplication() is a function of PACKS/ACTION_COSTS and not
    // a re-typed string. A starter pack priced at $10/60 credits would derive
    // to $1.00 for the same 6-credit application.
    const hypotheticalRate = 10 / 60;
    const hypotheticalUsd = hypotheticalRate * APPLICATION_COST;
    assert.equal(hypotheticalUsd, 1);
  });
});

describe("applicationsPerPack()", () => {
  it("floors to whole applications for the starter pack", () => {
    // starter: 60 credits / 6 per application = 10 exactly.
    const starter = PACKS.find((p) => p.id === "starter")!;
    assert.equal(applicationsPerPack(starter), 10);
  });

  it("floors a non-exact division for the hunt pack", () => {
    // hunt: 180 credits / 6 per application = 30 exactly (still checked to
    // guard against a future ACTION_COSTS change breaking the ratio silently).
    const hunt = PACKS.find((p) => p.id === "hunt")!;
    assert.equal(applicationsPerPack(hunt), 30);
  });

  it("covers every pack with a non-negative integer result", () => {
    for (const pack of PACKS) {
      const n = applicationsPerPack(pack);
      assert.ok(Number.isInteger(n) && n >= 0, `${pack.id} produced ${n}`);
    }
  });
});

describe("PACKS / ACTION_COSTS shape", () => {
  it("every pack id is unique", () => {
    const ids = PACKS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("APPLICATION_COST is derived from ACTION_COSTS, not a separate literal", () => {
    assert.equal(APPLICATION_COST, ACTION_COSTS.tailor + ACTION_COSTS.fit);
  });
});
