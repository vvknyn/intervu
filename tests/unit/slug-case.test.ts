import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowercaseSlugPath } from "@/lib/seo/slug-case";

describe("lowercaseSlugPath", () => {
  it("lowercases a mixed-case company slug", () => {
    assert.equal(lowercaseSlugPath("/co/Amazon--Com"), "/co/amazon--com");
  });
  it("covers /careers hub slugs too", () => {
    assert.equal(lowercaseSlugPath("/careers/Remote-Jobs"), "/careers/remote-jobs");
  });
  it("leaves lowercase slugs, other routes and nested paths alone", () => {
    for (const p of ["/co/amazon--com", "/careers/remote-jobs", "/jobs/Some-Id", "/co", "/co/", "/co/letter/A"]) {
      assert.equal(lowercaseSlugPath(p), null, p);
    }
  });
});
