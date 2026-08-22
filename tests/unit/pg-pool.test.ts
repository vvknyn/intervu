import { test } from "node:test";
import assert from "node:assert/strict";

test("getIntervuPg returns null without INTERVU_PG_URL", async () => {
  delete process.env.INTERVU_PG_URL;
  const { getIntervuPg, isIdentityStoreEnabled } = await import("../../src/lib/pg/pool");
  assert.equal(getIntervuPg(), null);
  assert.equal(isIdentityStoreEnabled(), false);
});
