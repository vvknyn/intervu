import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nameAgreeingWithDomain, resolveCompanyName } from "@/lib/companies/company-name";

const shown = (company: string, domain: string): string => resolveCompanyName([{ company }], domain).value;

describe("companies/company-name — a corpus name must agree with the domain", () => {
  it("falls back to the domain label for a name the domain does not carry (prod evidence: vendor artifacts)", () => {
    const rejected: [string, string, string][] = [
      ["americanfamilycare.com", "Careerplug", "Americanfamilycare"],
      ["body20.com", "Careerplug", "Body20"],
      ["aerospace.circor.com", "2nd Shift", "Aerospace"],
      ["m-s.ch", "Associate", "M S"],
      // not in the evidence: the same vendor string on another domain
      ["avanta.care", "Careerplug", "Avanta"],
    ];
    for (const [domain, company, expected] of rejected) assert.equal(resolveCompanyName([{ company }], domain).value, expected, domain);
  });

  it("never shows a name the domain does not carry, however dominant, and reports that it did not agree", () => {
    const sole = resolveCompanyName([{ company: "Bank of Montreal" }], "airmiles.ca");
    assert.deepEqual([sole.value, sole.source, sole.agrees, sole.share], ["Airmiles", "domain", false, 0]);
    const sixty = resolveCompanyName([...Array(3).fill({ company: "Anduril Industries" }), ...Array(2).fill({ company: "Asml" })], "mighty.com");
    assert.deepEqual([sixty.value, sixty.agrees], ["Mighty", false]);
    assert.equal(resolveCompanyName([], "empty.com").value, "Empty");
  });

  it("strips an identifier token or picks the agreeing segment", () => {
    assert.equal(shown("22-3844417 Broadridge Investor Comm Solutions", "broadridge.com"), "Broadridge Investor Comm Solutions");
    assert.equal(shown("CA10382-CANADA AIR LIQUIDE CANADA", "airliquide.com"), "Air Liquide");
    assert.equal(shown("200_Mohegan_Sun Mohegan Tribal Gaming Authority - Mohegan Sun", "mohegansun.com"), "Mohegan Sun");
  });

  it("keeps a whole-string failure failed even when a segment would agree on its own", () => {
    assert.equal(nameAgreeingWithDomain("Hôpitaux Shriners pour enfants - Canada", "shrinerscanada.org"), null);
  });

  it("keeps clean agreeing names verbatim", () => {
    assert.equal(shown("Anduril Industries", "anduril.com"), "Anduril Industries");
    assert.equal(shown("Sandvik", "home.sandvik"), "Sandvik");
  });

  it("agrees through initials and prefix composition", () => {
    assert.equal(shown("International Business Machines", "ibm.com"), "International Business Machines");
    assert.equal(shown("University of Chicago", "uchicago.edu"), "University of Chicago");
    assert.equal(shown("University of Alabama at Birmingham", "uab.edu"), "University of Alabama at Birmingham");
    assert.equal(shown("Canadian Imperial Bank of Commerce (Canada)", "cibc.com"), "Canadian Imperial Bank of Commerce (Canada)");
    assert.equal(shown("The Manufacturers Life Insurance Company", "manulife.com"), "The Manufacturers Life Insurance Company");
    assert.equal(shown("GlobalFoundries", "gf.com"), "GlobalFoundries");
  });

  it("keeps a leading identifier the domain label starts with", () => {
    assert.equal(shown("84 Lumber", "84lumber.com"), "84 Lumber");
    assert.equal(shown("3M", "3m.com"), "3M");
  });

  it("lets the agreeing candidate win over a more frequent unrelated one", () => {
    const jobs = [...Array(5).fill({ company: "Careerplug" }), { company: "Body20" }];
    assert.equal(resolveCompanyName(jobs, "body20.com").value, "Body20");
  });

  it("N1: folds diacritics and & to and; a label also matches without trailing digits or a trailing legal suffix", () => {
    assert.equal(shown("Société Générale", "societegenerale.com"), "Société Générale");
    assert.equal(shown("Marks & Spencer", "marksandspencer.com"), "Marks & Spencer");
    assert.equal(shown("Quantum Dynamics", "quantumdynamics2.com"), "Quantum Dynamics");
    assert.equal(shown("Brightleaf", "brightleafinc.com"), "Brightleaf");
    assert.equal(nameAgreeingWithDomain("Brightleaf", "darkroot.com"), null);
  });

  it("N2: keeps the unstripped name when stripping the leading identifier loses the agreement", () => {
    assert.equal(shown("K9Solutions Group", "k9solutions.com"), "K9Solutions Group");
    assert.equal(shown("4-1234 Pinecrest Foods", "pinecrestfoods.com"), "Pinecrest Foods");
  });

  it("N3: an agreeing candidate starting at its first word beats a more frequent one that only contains the label", () => {
    const jobs = [...Array(3).fill({ company: "Wolf Zephyr Peak" }), { company: "Zephyr Peak" }];
    assert.equal(resolveCompanyName(jobs, "zephyrpeak.com").value, "Zephyr Peak");
  });

  it("N4: dba / d/b/a / at separate segments; only leading code words are dropped before the label word", () => {
    assert.equal(shown("Harbor Holdings LLC dba Cobalt Grill", "cobaltgrill.com"), "Cobalt Grill");
    assert.equal(shown("Harbor Holdings d/b/a Cobalt Grill", "cobaltgrill.com"), "Cobalt Grill");
    assert.equal(shown("Cobalt Grill at Harbor Square", "harborsquare.com"), "Harbor Square");
    assert.equal(shown("LPSC Ayvens", "ayvens.com"), "Ayvens");
    assert.equal(shown("NU USA Northeastern University", "northeastern.edu"), "Northeastern University");
    assert.equal(shown("Mixed Prefix Ayvens", "ayvens.com"), "Mixed Prefix Ayvens");
  });

  it("reports whether the shown name agreed, and its share of the named rows", () => {
    const agreeing = resolveCompanyName([{ company: "Anduril Industries" }], "anduril.com");
    assert.deepEqual([agreeing.agrees, agreeing.share], [true, 1]);
    const mixed = resolveCompanyName([...Array(3).fill({ company: "Zephyr Peak" }), { company: "Elsewhere" }], "zephyrpeak.com");
    assert.deepEqual([mixed.agrees, mixed.share], [true, 0.75]);
  });

  it("Q2: a flat single-token name of 2-3 letters reads as an acronym unless it is an ordinary word; cased and longer names are untouched", () => {
    assert.equal(shown("xyz", "xyz.com"), "XYZ");
    assert.equal(shown("qb", "qb.com"), "QB");
    assert.equal(shown("sky", "sky.com"), "Sky");
    assert.equal(shown("zork", "zork.com"), "Zork");
    assert.equal(shown("Xyz", "xyz.com"), "Xyz");
    assert.equal(shown("xyz labs", "xyzlabs.com"), "Xyz Labs");
  });

  it("R3: spellings of one name vote together; the shown form is the commonest that is not flat lower-case", () => {
    assert.equal(shown("tdsynnex", "tdsynnex.com"), "Tdsynnex");
    const synnex = [...Array(5).fill({ company: "tdsynnex" }), ...Array(2).fill({ company: "TD SYNNEX" })];
    assert.equal(resolveCompanyName(synnex, "tdsynnex.com").value, "TD Synnex");
    const orchid = [...Array(3).fill({ company: "Orchid Foods Group" }), ...Array(2).fill({ company: "Orchid Foods" }), { company: "ORCHID FOODS" }, { company: "orchidfoods" }];
    assert.equal(resolveCompanyName(orchid, "orchidfoods.com").value, "Orchid Foods");
    const datadog = [{ company: "Datadog" }, ...Array(4).fill({ company: "datadog" })];
    assert.equal(resolveCompanyName(datadog, "datadog.com").value, "Datadog");
  });
});

describe("companies/company-name — ATS entity codes", () => {
  it("a multi-underscore entity code never leaks into the resolved display name", () => {
    const rows = Array(3).fill({ company: "US_XYZ_1000 Xyz Corporation" });
    assert.equal(resolveCompanyName(rows, "xyzcorporation.com").value, "Xyz Corporation");
  });
});
