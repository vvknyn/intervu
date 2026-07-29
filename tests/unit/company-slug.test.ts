import assert from "node:assert/strict";
import { describe, it } from "node:test";
import elite from "../../data/boards/elite-domains.json";
import { decodeSlug, domainToSlug, slugToDomain } from "@/lib/boards/slug";

describe("boards/slug", () => {
  it("round-trips every elite domain", () => {
    for (const raw of elite as string[]) {
      const domain = raw.trim().toLowerCase();
      const slug = domainToSlug(domain);
      assert.equal(decodeSlug(slug), domain);
      assert.equal(slugToDomain(slug), domain);
    }
  });

  it("lowercases and trims on encode", () => {
    assert.equal(domainToSlug("  Stripe.COM  "), "stripe--com");
  });

  it("rejects invalid slugs", () => {
    assert.equal(slugToDomain(""), null);
    assert.equal(slugToDomain("not-a-domain"), null);
    assert.equal(slugToDomain("unknown-co"), null);
  });
});
