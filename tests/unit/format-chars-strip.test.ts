import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { siteSpelling } from "@/lib/companies/company-name";
import { parseCompanyDirectoryHit } from "@/lib/companies/indexable";
import { cleanCompany, decodeText, stripFormatChars } from "@/lib/jobs/presentation";

describe("invisible Unicode format characters never reach visible text", () => {
  it("a U+200E inside a site-name segment: the adopted spelling comes out clean", () => {
    const hit = parseCompanyDirectoryHit({ domain: "acme.org", open_role_count: 3, site_names: ["Blue‎ Harbor | Home"] });
    assert.deepEqual(hit?.siteNames, ["Blue Harbor | Home"]);
    assert.equal(siteSpelling("Blue Harbor", hit?.siteNames ?? [], "acme.org"), "Blue Harbor");
  });

  it("every directory name field is cleaned; a name that is only marks is dropped", () => {
    const hit = parseCompanyDirectoryHit({ domain: "a.com", open_role_count: 1, site_names: ["​"], wikidata_names: ["Ac­me"], row_names: ["‏Acme Corp"] });
    assert.equal(hit?.siteNames, undefined);
    assert.deepEqual(hit?.labelSpellings, ["Acme", "Acme Corp"]);
  });

  it("a U+FEFF at the start of a row company", () => {
    assert.equal(cleanCompany("﻿Northwind Traders"), "Northwind Traders");
  });

  it("a U+00AD soft hyphen and a U+200B inside a job title", () => {
    assert.equal(decodeText("Senior­ Soft​ware Engineer"), "Senior Software Engineer");
  });

  it("removing a mark never leaves a doubled or edge space", () => {
    assert.equal(decodeText("​ Staff ​ Engineer ﻿"), "Staff Engineer");
  });

  it("strips after URL-decoding too", () => {
    assert.equal(decodeText("Wisdom%20​AI"), "Wisdom AI");
  });

  it("a U+200F in an Arabic name", () => {
    assert.equal(stripFormatChars("شركة‏ النور"), "شركة النور");
  });

  it("KEPT: a ZWJ emoji sequence and a ZWNJ in a Persian name", () => {
    assert.equal(decodeText("Developer 👩‍💻"), "Developer 👩‍💻");
    assert.equal(decodeText("می‌خواهم"), "می‌خواهم");
  });

  it("KEPT: emoji tag characters (subdivision flag)", () => {
    const flag = "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
    assert.equal(decodeText(`Team ${flag}`), `Team ${flag}`);
  });

  it("text without format characters is returned untouched, spacing included", () => {
    assert.equal(stripFormatChars("a  b"), "a  b");
  });
});
