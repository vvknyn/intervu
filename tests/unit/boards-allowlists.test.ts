import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBoardDomains, isBoardId } from "@/lib/boards/allowlists";

describe("boards/allowlists", () => {
  it("accepts elite and rejects unknown", () => {
    assert.equal(isBoardId("elite"), true);
    assert.equal(isBoardId("nope"), false);
  });
  it("returns normalized lowercase domains for elite", () => {
    const domains = getBoardDomains("elite");
    assert.ok(domains.length >= 50);
    assert.ok(domains.every((d) => d === d.toLowerCase() && !d.includes("http")));
  });
});
