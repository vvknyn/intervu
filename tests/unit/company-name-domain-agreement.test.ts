import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nameAgreeingWithDomain, resolveCompanyName } from "@/lib/companies/company-name";

const shown = (company: string, domain: string): string => resolveCompanyName([{ company }], domain).value;

describe("companies/company-name — a corpus name must agree with the domain", () => {
  it("falls back to the domain label for an unrelated or vendor string (prod evidence)", () => {
    const rejected: [string, string, string][] = [
      ["airmiles.ca", "Bank of Montreal", "Airmiles"],
      ["americanfamilycare.com", "Careerplug", "Americanfamilycare"],
      ["body20.com", "Careerplug", "Body20"],
      ["benjaminfranklinplumbingiowa.com", "Careerplug", "Benjaminfranklinplumbingiowa"],
      ["ml.com", "94-1687665 Bank of America, National Association", "Ml"],
      ["bostonfed.org", "04D Federal Reserve Bank of Cleveland", "Bostonfed"],
      ["mighty.com", "Anduril Industries", "Mighty"],
      ["mybamm.org", "Asml", "Mybamm"],
      ["m-s.ch", "Associate", "M S"],
      ["aerospace.circor.com", "2nd Shift", "Aerospace"],
      ["breedinginsight.org", "Cornell", "Breedinginsight"],
      // not in the evidence: the same vendor string on other domains
      ["avanta.care", "Careerplug", "Avanta"],
      ["marathon.health", "MH Health Care Services PC", "Marathon"],
    ];
    for (const [domain, company, expected] of rejected) assert.equal(shown(company, domain), expected, domain);
  });

  it("strips an identifier token or picks the agreeing segment", () => {
    assert.equal(shown("22-3844417 Broadridge Investor Comm Solutions", "broadridge.com"), "Broadridge Investor Comm Solutions");
    assert.equal(shown("CA10382-CANADA AIR LIQUIDE CANADA", "airliquide.com"), "CANADA AIR LIQUIDE CANADA");
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
});
