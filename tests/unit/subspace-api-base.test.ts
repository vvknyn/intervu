import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { subspaceApiBase } from "../../src/lib/jobs/subspaceJobs";

describe("subspaceApiBase", () => {
  it("throws a named error when SUBSPACE_API_BASE_URL is unset (no public default)", () => {
    const prev = process.env.SUBSPACE_API_BASE_URL;
    delete process.env.SUBSPACE_API_BASE_URL;
    try {
      assert.throws(() => subspaceApiBase(), /SUBSPACE_API_BASE_URL is not set/);
    } finally {
      if (prev !== undefined) process.env.SUBSPACE_API_BASE_URL = prev;
    }
  });

  it("returns the env value with trailing slashes trimmed", () => {
    const prev = process.env.SUBSPACE_API_BASE_URL;
    process.env.SUBSPACE_API_BASE_URL = "http://subspace:3000/api/v1//";
    try {
      assert.equal(subspaceApiBase(), "http://subspace:3000/api/v1");
    } finally {
      if (prev === undefined) delete process.env.SUBSPACE_API_BASE_URL;
      else process.env.SUBSPACE_API_BASE_URL = prev;
    }
  });
});
