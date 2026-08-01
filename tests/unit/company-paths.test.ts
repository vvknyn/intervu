import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { companyFromSlug, companyPagePath, jobCompanyHref } from "../../src/lib/companies/paths";

const NASTY_NAMES = [
  "AT&T",
  "Ernst & Young",
  "株式会社ソニー", // unicode (Japanese)
  "Café Münchën & Co.", // accented unicode + ampersand
  "Acme Corp  ", // trailing spaces
  "  Leading Space Co", // leading spaces
  "50% Raise Co", // literal percent sign
  "C++ Systems / R&D",
];

function slugSegment(path: string): string {
  assert.equal(path.startsWith("/companies/"), true, `expected /companies/ prefix, got ${path}`);
  return path.slice("/companies/".length);
}

describe("companies/paths", () => {
  it("round-trips every nasty company name exactly", () => {
    for (const name of NASTY_NAMES) {
      const path = companyPagePath(name);
      const decoded = companyFromSlug(slugSegment(path));
      assert.equal(decoded, name, `round-trip failed for ${JSON.stringify(name)}`);
    }
  });

  it("produces a URL-safe path (no raw spaces/&/unicode leak into the segment)", () => {
    for (const name of NASTY_NAMES) {
      const segment = slugSegment(companyPagePath(name));
      assert.doesNotMatch(segment, /[\s&]/, `segment for ${JSON.stringify(name)} leaked an unsafe char`);
    }
  });

  it("is stable under a second decode — Next.js's router already decodes params.slug\n     once before a page sees it, so companyFromSlug must tolerate being called\n     on an already-decoded value without corrupting or throwing", () => {
    for (const name of NASTY_NAMES) {
      const onceDecoded = companyFromSlug(slugSegment(companyPagePath(name)));
      assert.equal(companyFromSlug(onceDecoded), onceDecoded);
    }
  });

  it("never throws on arbitrary already-decoded input", () => {
    assert.doesNotThrow(() => companyFromSlug("50% not a real escape"));
    assert.equal(companyFromSlug("50% not a real escape"), "50% not a real escape");
  });
});

describe("jobCompanyHref", () => {
  it("links straight to /co/[slug] when a company_domain is present", () => {
    assert.equal(jobCompanyHref("Acme Corp", "acme.com"), "/co/acme--com");
  });

  it("falls back to the name-keyed /companies path when no domain is known", () => {
    assert.equal(jobCompanyHref("Acme Corp", null), companyPagePath("Acme Corp"));
  });

  it("normalizes casing/whitespace via domainToSlug, matching every other /co/ caller", () => {
    assert.equal(jobCompanyHref("Acme Corp", "  Acme.COM  "), "/co/acme--com");
  });
});
