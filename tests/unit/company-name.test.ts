import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brandTokens, displayNameFromDomain, resolveCompanyName, siteSpelling } from "@/lib/companies/company-name";
import { displayCompanyName } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * Build the job rows for a company from a `{ name: rowCount }` tally. Every
 * fixture below is a REAL distribution read off the live index on 2026-08-11
 * (`company_domain = "<domain>"`, tallied by `company`) — the counts matter,
 * because the defect this file pins is that the correct name is often the
 * RAREST one.
 */
function rows(tally: Record<string, number>): Pick<PublicJob, "company">[] {
  return Object.entries(tally).flatMap(([company, n]) =>
    Array.from({ length: n }, () => ({ company })),
  );
}

describe("companies/company-name — brand vs legal entity", () => {
  it("picks the brand even though the brand is the RAREST name on the domain (lumentum.com, live)", () => {
    // The whole point. A frequency/dominance rule cannot work here: the four
    // busiest strings are all subsidiaries and the brand has 2 rows out of 213.
    // If a future change reintroduces "most rows wins", this test fails.
    const jobs = rows({
      "Lumentum Operations LLC": 64,
      "Lumentum International (Thailand) Co. Ltd.": 63,
      "Lumentum Japan, Inc.": 25,
      "Lumentum Ottawa ULC": 21,
      "Lumentum Technology UK Limited": 15,
      "Cloud Light Technology Ltd (Dongguan)": 6,
      "Lumentum Communication Technology (Shenzhen) Co. Ltd.": 4,
      "Oclaro Technology (Shenzhen) (FFTZ) Co. Ltd": 3,
      Lumentum: 2,
    });
    const resolved = resolveCompanyName(jobs, "lumentum.com");
    assert.equal(resolved.value, "Lumentum");
    assert.equal(resolved.source, "corpus-cased");
    // Not merely "shorter than before" — it must be the brand, not the
    // busiest subsidiary the page used to render.
    assert.notEqual(resolved.value, "Lumentum International (Thailand) Co. Ltd.");
  });

  it("generalises to a different employer with a different qualifier vocabulary (boeing.com.au, live)", () => {
    // Non-Lumentum multi-entity case: 2002 rows say "The Boeing Company" and
    // 88 say "Boeing". Qualifiers here are countries and business units, and
    // some siblings ("Millennium Space Systems") share no stem at all — the
    // rule must not need every row to agree.
    const jobs = rows({
      "The Boeing Company": 2002,
      "Millennium Space Systems": 108,
      "Boeing Aerospace Operations": 89,
      Boeing: 88,
      "Boeing Defence United Kingdom Limited": 86,
      "Boeing India Private Limited": 38,
      "Boeing Distribution, Inc.": 31,
      "Boeing Korea LLC": 18,
    });
    assert.equal(resolveCompanyName(jobs, "boeing.com.au").value, "Boeing");
  });

  it("displays the root VERBATIM when the root's own name ends in a legal form (jabil.com)", () => {
    // "Jabil Inc." roots seven differently-qualified siblings. The suffix
    // stripper is what lets it be recognised as the root — and the name is
    // still rendered in full. It must never be shortened to "Jabil": the
    // corpus never asserted that string.
    const jobs = rows({
      "Jabil Inc.": 464,
      "Jabil Circuit de Mexico, S. de R.L. de C.V.": 150,
      "Jabil Circuit de Chihuahua S. de R.L. de C.V.": 123,
      "Nypro Inc.": 65,
      "Jabil Technology Vietnam Company Limited": 45,
      "Jabil Circuit Sdn Bhd": 35,
      "Jabil Circuit India Private Limited": 32,
    });
    const resolved = resolveCompanyName(jobs, "jabil.com");
    assert.equal(resolved.value, "Jabil Inc.");
    // "Jabil Circuit" also roots ≥2 siblings; the SHORTER stem has to win, or
    // the page names itself after a mid-level division.
    assert.notEqual(resolved.value, "Jabil Circuit Sdn Bhd");
  });

  it("drops a spurious geographic qualifier without inventing a name (hitachicapitalamerica.com, live)", () => {
    // No bare "Hitachi" or "Hitachi Energy" row exists, so the resolver may
    // not produce one. What it CAN do is prefer the attested row whose stem
    // roots the others over the busiest country entity.
    const jobs = rows({
      "HITACHI ENERGY USA INC": 257,
      "HITACHI ENERGY TECHNOLOGY SERVICES PRIVATE LIMITED": 241,
      "HITACHI ENERGY SWEDEN AB": 192,
      "HITACHI ENERGY INDIA LIMITED": 154,
      "HITACHI ENERGY LTD": 108,
      "HITACHI VANTARA LLC": 50,
    });
    const resolved = resolveCompanyName(jobs, "hitachicapitalamerica.com");
    assert.equal(resolved.value, "Hitachi Energy LTD");
    // All-caps carries no case information — the existing honesty flag is
    // untouched by the new selection step.
    assert.equal(resolved.source, "corpus-flat");
  });

  it("leaves a single-entity employer exactly as it was (no regression)", () => {
    const jobs = rows({ "Acme Robotics": 40 });
    const resolved = resolveCompanyName(jobs, "acme.com");
    assert.equal(resolved.value, "Acme Robotics");
    assert.equal(resolved.source, "corpus-cased");
  });

  it("does not mangle a genuine name that ends in a legal-form word, with or without siblings", () => {
    // Single entity: the trailing "& Co." is part of the name and is shown.
    assert.equal(
      resolveCompanyName(rows({ "Levi Strauss & Co.": 30 }), "levi.com").value,
      "Levi Strauss & Co.",
    );
    // With siblings the stem is used for MATCHING only — the display string
    // still comes back whole.
    assert.equal(
      resolveCompanyName(
        rows({
          "Levi Strauss & Co.": 3,
          "Levi Strauss Japan K.K.": 40,
          "Levi Strauss Europe SA": 25,
        }),
        "levi.com",
      ).value,
      "Levi Strauss & Co.",
    );
    // Words that merely LOOK corporate ("Group", "Labs", "Technologies") are
    // not legal forms and are never stripped, so they still distinguish two
    // sibling entities from each other.
    assert.equal(
      resolveCompanyName(
        rows({ "Constellation Technologies": 12, "Constellation Labs": 9 }),
        "constellationtech.com",
      ).value,
      "Constellation Technologies",
    );
    // A legal-form token at the START is part of the name, never a suffix.
    assert.deepEqual(brandTokens("AB InBev"), ["ab", "inbev"]);
    assert.deepEqual(brandTokens("LTD Commodities LLC"), ["ltd", "commodities"]);
    // A company whose entire name is a legal form is never hollowed out.
    assert.deepEqual(brandTokens("Limited"), ["limited"]);
  });

  it("keeps the row-count vote when the corpus shows no qualification pattern", () => {
    // One sibling is not evidence of a brand-and-subsidiaries structure, so
    // "Zoom" (8 rows) does not displace the attested legal name (zoom.us, live).
    const zoom = rows({
      "Zoom Communications, Inc.": 121,
      "ZVC Japan K.K.": 25,
      "ZVC UK Ltd": 13,
      Zoom: 8,
    });
    assert.equal(resolveCompanyName(zoom, "zoom.us").value, "Zoom Communications, Inc.");

    // Token alignment: "Micron" does not root "303A Micron …" (micron.com, live).
    const micron = rows({
      Micron: 4604,
      "303A Micron Semiconductor Technology India": 87,
      "303C Micron Semiconductor Technology India": 15,
    });
    assert.equal(resolveCompanyName(micron, "micron.com").value, "Micron");
  });

  it("still recovers casing from a sibling row and still falls back to the domain", () => {
    const flat = rows({ "1password": 5, "1Password": 1 });
    const cased = resolveCompanyName(flat, "1password.com");
    assert.equal(cased.value, "1Password");
    assert.equal(cased.source, "corpus-cased");

    const none = resolveCompanyName(rows({ "acme.applicantpro.com": 4 }), "acme-corp.com");
    assert.equal(none.value, "Acme Corp");
    assert.equal(none.source, "domain");
  });

  // Corpus measurement 2026-08-18: 429 live rows carry `company: "Checkout.Com"`
  // — the employer's real name, styled like a domain, not an ATS-hostname
  // placeholder. The `isCompanyPlaceholder` gate added above (so an ATS
  // hostname can't outrank the domain fallback) also matches this shape, so
  // every row is skipped as non-evidence — but the domain fallback lands on
  // the SAME value ("Checkout") the pre-existing bare-domain TLD-strip
  // already produced, so the gate causes no value regression here: only the
  // (unread) provenance label changes, from a guessed "corpus-cased" to the
  // more honest "domain".
  it("resolves a domain-styled real brand name to the same value whether read as corpus evidence or as a domain fallback (checkout.com, live)", () => {
    const resolved = resolveCompanyName(rows({ "Checkout.Com": 429 }), "checkout.com");
    assert.equal(resolved.value, "Checkout");
  });

  // The domain fallback (`displayNameFromDomain`) used to capitalize on `\b`
  // word boundaries only, which never fires between a digit and the letter
  // right after it — "23andme.com" and "1password.com" came back exactly as
  // lowercase as the raw domain label. Covers a second, different domain
  // shape (not just the two named in the bug report) to prove the fix is the
  // general "capitalize after any non-letter" rule, not two hardcoded names.
  it("capitalizes a domain label even where a digit sits directly against a letter, with no corpus evidence at all", () => {
    assert.equal(displayNameFromDomain("23andme.com"), "23Andme");
    assert.equal(displayNameFromDomain("1password.com"), "1Password");
    assert.equal(displayNameFromDomain("6sense.com"), "6Sense");
    // Unaffected shapes stay exactly as before.
    assert.equal(displayNameFromDomain("acme-corp.com"), "Acme Corp");
    assert.equal(displayNameFromDomain("stripe.com"), "Stripe");
  });

  it("never leaves the raw lowercase domain-shaped string as the resolved name when the corpus carries no evidence", () => {
    const resolved = resolveCompanyName([], "23andme.com");
    assert.equal(resolved.source, "domain");
    assert.notEqual(resolved.value, "23andme");
    assert.equal(resolved.value, "23Andme");
  });

  // Live bug, intervuhq.com/co/1password--com after PR #258: every row on the
  // domain spells the name flat ("1password"), so there is no cased witness
  // (`best.cased` stays null) and the winning group is exactly as
  // casing-free as a bare domain label — it must get the same recovery, not
  // be shown verbatim.
  it("recovers casing on a corpus-flat name with no cased witness anywhere in the group (1password.com, live)", () => {
    const resolved = resolveCompanyName(rows({ "1password": 2 }), "1password.com");
    assert.equal(resolved.value, "1Password");
    assert.equal(resolved.source, "corpus-flat");
  });

  it("generalises corpus-flat recovery to a second employer, not just the one that surfaced the bug (monzo.com)", () => {
    const resolved = resolveCompanyName(rows({ monzo: 3 }), "monzo.com");
    assert.equal(resolved.value, "Monzo");
    assert.equal(resolved.source, "corpus-flat");
  });

  it("does not touch the corpus-cased path: a lone cased row still wins verbatim (survivor)", () => {
    const resolved = resolveCompanyName(rows({ eBay: 5 }), "ebay.com");
    assert.equal(resolved.value, "eBay");
    assert.equal(resolved.source, "corpus-cased");
  });

  it("does not touch the corpus-cased path: a cased witness among flat siblings wins verbatim (survivor)", () => {
    const resolved = resolveCompanyName(rows({ Datadog: 1, datadog: 4 }), "datadog.com");
    assert.equal(resolved.value, "Datadog");
    assert.equal(resolved.source, "corpus-cased");
  });
});

describe("siteSpelling — SP: the company's own spelling of the agreed name", () => {
  it("shows the first candidate that only respells the name", () => {
    assert.equal(siteSpelling("Aspendental", ["Aspen Dental"]), "Aspen Dental");
    assert.equal(siteSpelling("AIR LIQUIDE", ["Air Liquide"]), "Air Liquide");
    assert.equal(siteSpelling("Johnson and Johnson", ["Johnson & Johnson"]), "Johnson & Johnson");
    assert.equal(siteSpelling("Societe Generale", ["Société Générale"]), "Société Générale");
    assert.equal(siteSpelling("Fooco", ["Home", "Foo Co", "FOO-CO"]), "Foo Co");
  });

  it("never shows different letters, an all-caps banner, or anything when there are no candidates", () => {
    assert.equal(siteSpelling("Abbott Laboratories", ["Abbott"]), "Abbott Laboratories");
    assert.equal(siteSpelling("Fiveguys", ["FIVE GUYS"]), "Fiveguys");
    assert.equal(siteSpelling("Fiveguys", []), "Fiveguys");
    assert.equal(siteSpelling("Fiveguys"), "Fiveguys");
    assert.equal(siteSpelling("Acme", ["Acme"]), "Acme");
  });

  it("drops trademark signs from a candidate before comparing and returning it", () => {
    assert.equal(siteSpelling("Blackrock", ["BlackRock®"]), "BlackRock");
    assert.equal(siteSpelling("Fiveguys", ["Five Guys ™"]), "Five Guys");
    assert.equal(siteSpelling("Blackrock", ["Blackrock®"]), "Blackrock");
  });

  it("allows an all-caps acronym of four letters or fewer", () => {
    assert.equal(siteSpelling("aaff", ["AAFF"]), "AAFF");
  });
});

describe("siteSpelling — SQ: a display that is only the squashed domain word takes the site's expansion of it", () => {
  const sq = (display: string, domain: string, names: string[]) => siteSpelling(display, names, domain);

  it("expands the domain word to the shortest anchored multi-word site name", () => {
    assert.equal(
      sq("Pyramidhc", "pyramidhc.com", ["Pyramid Healthcare Corporate", "An Integrated Behavioral Healthcare System", "Pyramid Healthcare"]),
      "Pyramid Healthcare",
    );
    assert.equal(sq("Westpharma", "westpharma.com", ["West Pharmaceutical Services"]), "West Pharmaceutical Services");
    assert.equal(sq("Txtav", "txtav.com", ["Textron Aviation"]), "Textron Aviation");
  });

  it("never picks a tagline, junk, another company or a bare/longer form of a real word", () => {
    assert.equal(sq("Toast", "toast.com", ["NHN Cloud"]), "Toast");
    assert.equal(sq("Marel", "marel.com", ["JBT Marel"]), "Marel");
    assert.equal(sq("Anthropic", "anthropic.com", ["Home \\ Anthropic"]), "Anthropic");
    assert.equal(sq("Borgwarner", "borgwarner.com", ["Home"]), "Borgwarner");
    assert.equal(sq("Staples", "staples.com", ["Staples.com"]), "Staples");
    assert.equal(sq("Genmab", "genmab.com", ["Welcome to Genmab"]), "Genmab");
    assert.equal(sq("Yale", "yale.edu", ["Yale University"]), "Yale");
    assert.equal(sq("Shell", "shell.com", ["Shell Global"]), "Shell");
    assert.equal(sq("Acme", "acme.com", ["Acme | Widgets Co", "Acme, Widgets Co", "Acme: Widgets Co"]), "Acme");
  });

  it("respells the domain word as the site's cased first word, only when that word carries casing", () => {
    assert.equal(sq("Bnsf", "bnsf.com", ["BNSF Railway"]), "BNSF");
    assert.equal(sq("Mccain", "mccain.com", ["McCain Foods Global Corporate"]), "McCain");
    assert.equal(sq("Nvent", "nvent.com", ["nVent Electric"]), "nVent");
    assert.equal(sq("Sendiks", "sendiks.com", ["Sendik's Food Market"]), "Sendik's");
    assert.equal(sq("Pei", "pei.com", ["PEI + Dataprise"]), "PEI");
    assert.equal(sq("Mccain", "mccain.com", ["McCain Foods Global Corporate", "McCain Foods Global Corporate Website", "McCain.com"]), "McCain");
    assert.equal(sq("Omv", "omv.com", ["OMV Aktiengesellschaft", "OMV Home", "OMV.com"]), "OMV");
    assert.equal(sq("NGC", "ngc.com", ["Ngc Construction"]), "NGC");
    assert.equal(sq("Iceye", "iceye.com", ["ICEYE Space Systems"]), "Iceye");
    assert.equal(sq("Yale", "yale.edu", ["Yale University"]), "Yale");
  });

  it("accepts a typographic apostrophe in an expansion", () => {
    assert.equal(sq("Archildrens", "archildrens.org", ["Arkansas Children\u2019s"]), "Arkansas Children\u2019s");
    assert.equal(sq("Acme", "acme.com", ["#1 Acme Widgets Co"]), "Acme");
  });

  it("leaves a display that is not the domain word alone", () => {
    assert.equal(sq("Kering Eyewear", "kering.com", ["Kering Eyewear Group"]), "Kering Eyewear");
  });

  it("lets the same-key respell win over an expansion", () => {
    assert.equal(sq("Pyramidhc", "pyramidhc.com", ["Pyramid Healthcare", "Pyramid HC"]), "Pyramid HC");
    assert.equal(sq("Pyramidhc", "pyramidhc.com", ["Pyramid Healthcare", "Pyramid HC Inc"]), "Pyramid HC");
  });

  it("1. runs only for a one-word display (a spaced display is already spelled)", () => {
    assert.equal(sq("Accendra Health", "accendrahealth.com", ["Accendra Health Home Page"]), "Accendra Health");
    assert.equal(sq("Blue Harbor", "blueharbor.com", ["Blue Harbor Home Page"]), "Blue Harbor");
  });

  it("2. spells the label from word starts, not letters scattered through the phrase", () => {
    assert.equal(sq("Sienna", "siennaliving.com", ["Sienna Senior Living"]), "Sienna");
    assert.equal(sq("Siennaliving", "siennaliving.com", ["Sienna Senior Living"]), "Sienna Senior Living");
    assert.equal(sq("Pyebarkerfs", "pyebarkerfs.com", ["Pye-Barker Fire & Safety"]), "Pye-Barker Fire & Safety");
    assert.equal(sq("Imc", "imc.com", ["Institute of Management Consultants Australia"]), "Institute of Management Consultants Australia");
    // the old whole-name character subsequence accepted this (a,p from Apple; u,m,e from mid-word of Lumber)
    assert.equal(sq("Apume", "apume.com", ["Apple Lumber Co"]), "Apume");
  });

  it("3. drops a tagline after the shortest word prefix that spells the label", () => {
    assert.equal(sq("Airbushelicopters", "airbushelicopters.com", ["Airbus Helicopters in Canada"]), "Airbus Helicopters");
    assert.equal(sq("Lakeshorebakery", "lakeshorebakery.com", ["Lakeshore Bakery Fresh Daily"]), "Lakeshore Bakery");
  });

  it("4. rejects respellings that are lower-case, cut off, or drop a space without a case join", () => {
    assert.equal(sq("Acme Widgets", "acmewidgets.com", ["Acme Widgets -"]), "Acme Widgets");
    assert.equal(sq("Sun Life", "sunlife.com", ["Sunlife"]), "Sun Life");
    assert.equal(sq("Third Bridge", "thirdbridge.com", ["Thirdbridge"]), "Third Bridge");
    assert.equal(sq("Lincolnfinancial", "lincolnfinancial.com", ["lincolnfinancial"]), "Lincolnfinancial");
    assert.equal(sq("Naught One", "naughtone.com", ["NaughtOne"]), "NaughtOne");
    assert.equal(sq("Acmeco", "acmeco.com", ["Acme Co -"]), "Acmeco");
  });
});

describe("companies/company-name — brand stem spelled by the domain", () => {
  const name = (tally: Record<string, number>, domain: string) => resolveCompanyName(rows(tally), domain).value;

  it("aliaxis.it: regional entities, no bare row -> the stem the host spells", () => {
    assert.equal(
      name({ "Aliaxis Latin American Services": 5, "Aliaxis Iberia SAU (Spain)": 2, "Aliaxis UK Limited (United Kingdom)": 2 }, "aliaxis.it"),
      "Aliaxis",
    );
  });

  it("carat.com: the vote no longer flips between countries", () => {
    assert.equal(name({ "Carat Colombia": 3, "Carat Argentina": 4 }, "carat.com"), "Carat");
  });

  it("a multi-word stem is spelled with the siblings' own words (nordwindfreight.com)", () => {
    assert.equal(name({ "Nordwind Freight Ohio": 1, "Nordwind Freight Texas": 1 }, "nordwindfreight.com"), "Nordwind Freight");
  });

  it("no stem when the shared run does not spell the label (alphasys.com)", () => {
    assert.notEqual(name({ "Alpha Systems Inc": 1, "Alpha Networks LLC": 1 }, "alphasys.com"), "Alpha");
  });

  it("no stem from one qualified group (lakeviewclinic.org)", () => {
    assert.equal(name({ "Lakeview Clinic Hospital": 3 }, "lakeviewclinic.org"), "Lakeview Clinic Hospital");
  });

  it("groups differing only by a legal suffix are one sibling", () => {
    assert.equal(
      name({ "Acme Health India": 2, "Acme Health India Private Limited": 1 }, "acmehealth.com"),
      "Acme Health India",
    );
  });

  it("a bare root row keeps the existing pickBrandRoot result", () => {
    assert.equal(name({ Carat: 1, "Carat Colombia": 3, "Carat Argentina": 4 }, "carat.com"), "Carat");
    assert.equal(name({ "Carat Group": 1, "Carat Group Colombia": 3, "Carat Group Chile": 4 }, "carat.com"), "Carat Group");
  });
});

describe("siteSpelling — N1: a proper name that prefixes the squashed label", () => {
  const sq = (display: string, domain: string, names: string[]) => siteSpelling(display, names, domain);

  it("takes the cased or multi-word prefix name", () => {
    assert.equal(sq("Dunkindonuts", "dunkindonuts.com", ["Dunkin'®"]), "Dunkin'");
    assert.equal(sq("Atimaterials", "atimaterials.com", ["ATI"]), "ATI");
    assert.equal(sq("Evertrueliving", "evertrueliving.com", ["EverTrue"]), "EverTrue");
    assert.equal(sq("Circlecareservices", "circlecareservices.com", ["Circle Care"]), "Circle Care");
    assert.equal(sq("Publicisgroupeuk", "publicisgroupeuk.com", ["Publicis Groupe"]), "Publicis Groupe");
    assert.equal(sq("Scanscapeusa", "scanscapeusa.com", ["Scan Scape"]), "Scan Scape");
    assert.equal(sq("Stcharleshealthcare", "stcharleshealthcare.com", ["St. Charles Health"]), "St. Charles Health");
    assert.equal(sq("Unitedfutureinc", "unitedfutureinc.com", ["United Future"]), "United Future");
    assert.equal(sq("Blueridgeenergy", "blueridgeenergy.com", ["Blue Ridge"]), "Blue Ridge");
    assert.equal(sq("Fooexamplecorp", "fooexamplecorp.com", ["FooEx"]), "FooEx");
  });

  it("prefers the longest prefix key", () => {
    assert.equal(sq("Circlecareservices", "circlecareservices.com", ["Circle", "Circle Care", "CircleCare"]), "Circle Care");
  });

  it("rejects a single plain word, a banner, a too-short key, a cut phrase and a domain-like title", () => {
    assert.equal(sq("Homedepot", "homedepot.com", ["Home"]), "Homedepot");
    assert.equal(sq("Careersource", "careersource.com", ["Careers"]), "Careersource");
    assert.equal(sq("Agilitihealth", "agilitihealth.com", ["Agiliti"]), "Agilitihealth");
    assert.equal(sq("Bigcorpgroup", "bigcorpgroup.com", ["Bigcorp"]), "Bigcorpgroup");
    assert.equal(sq("Fiveguysburgers", "fiveguysburgers.com", ["FIVE GUYS"]), "Fiveguysburgers");
    assert.equal(sq("Acmewidgets", "acmewidgets.com", ["AW"]), "Acmewidgets");
    assert.equal(sq("Acmewidgets", "acmewidgets.com", ["Acme Widgets -"]), "Acmewidgets");
    assert.equal(sq("Acmewidgets", "acmewidgets.com", ["Acme.com Site"]), "Acmewidgets");
  });
});

describe("siteSpelling — N2: a site name carrying a legal form still respells", () => {
  it("respells through the cleaned candidate", () => {
    assert.equal(siteSpelling("Iqresourcegroup", ["IQ Resource Group, Inc."], "iqresourcegroup.com"), "IQ Resource Group");
    assert.equal(siteSpelling("Acmewidgets", ["Acme Widgets, LLC"], "acmewidgets.com"), "Acme Widgets");
    assert.equal(siteSpelling("Foobar", ["FooBar Ltd."], "foobar.com"), "FooBar");
  });

  it("raw spelling wins when it already respells, and a flat site name still does not", () => {
    assert.equal(siteSpelling("Acmewidgets", ["Acme Widgets", "Acme Widgets, LLC"], "acmewidgets.com"), "Acme Widgets");
    assert.equal(siteSpelling("Acmewidgets", ["acmewidgets inc"], "acmewidgets.com"), "Acmewidgets");
  });
});

describe("resolveCompanyName — N3: a glued legal form votes with its root", () => {
  const name = (tally: Record<string, number>, domain: string) => resolveCompanyName(rows(tally), domain);

  it("folds Ebayinc into eBay even when the glued group is busier", () => {
    const r = name({ eBay: 2, Ebayinc: 5 }, "ebay.com");
    assert.equal(r.value, "eBay");
    assert.equal(r.share, 1);
  });

  it("folds another glued form (corp) and keeps the busier root's spelling", () => {
    assert.equal(name({ Acme: 3, Acmecorp: 6, "Acme Labs Foo": 1 }, "acme.com").value, "Acme");
  });

  it("leaves a lone glued form, or a short remainder, alone", () => {
    assert.equal(name({ Ebayinc: 4 }, "ebay.com").value, "Ebayinc");
    assert.equal(name({ Zinc: 2, Z: 1 }, "zinc.com").value, "Zinc");
    assert.equal(name({ Ab: 1, Abinc: 4 }, "ab.com").value, "Abinc");
  });
});

describe("N4 — all-capitals banners carry no case", () => {
  const name = (tally: Record<string, number>, domain: string) => resolveCompanyName(rows(tally), domain);

  it("recovers case for a banner like it does for flat text", () => {
    assert.equal(name({ "PEOPLE AND BABY": 3 }, "peopleandbaby.com").value, "People and Baby");
    assert.equal(name({ "SCOTTISH POWER": 2 }, "scottishpower.com").value, "Scottish Power");
    assert.equal(name({ "FIVE GUYS": 2 }, "fiveguys.com").value, "Five Guys");
  });

  it("prefers a cased spelling over a banner, even when the banner is commoner", () => {
    assert.equal(name({ "SCOTTISH POWER": 5, "Scottish Power": 1 }, "scottishpower.com").value, "Scottish Power");
    assert.equal(name({ "FIVE GUYS": 5, "Five Guys": 1 }, "fiveguys.com").source, "corpus-cased");
  });

  it("leaves acronyms and mixed case unchanged", () => {
    assert.equal(name({ IBM: 3 }, "ibm.com").value, "IBM");
    assert.equal(name({ DHL: 3 }, "dhl.com").value, "DHL");
    assert.equal(name({ AAFF: 3 }, "aaff.com").value, "AAFF");
    assert.equal(name({ "DHL Express": 3 }, "dhl.com").value, "DHL Express");
    assert.equal(name({ "McCain Foods": 3 }, "mccain.com").value, "McCain Foods");
  });
});

describe("R1 — a folded glued legal form carries its spellings to the root", () => {
  const name = (tally: Record<string, number>, domain: string) => resolveCompanyName(rows(tally), domain).value;

  it("a flattened root does not outvote the company's own spelling it absorbed (invented names)", () => {
    assert.equal(name({ Acmeworks: 6, "Acme Works Corp": 2 }, "acmeworks.com"), "Acme Works");
    assert.equal(name({ Zetapharma: 3, "Zeta Pharma, Inc.": 9 }, "zetapharma.com"), "Zeta Pharma");
  });

  it("the folded spelling is cut after the shortest prefix that spells the root", () => {
    assert.equal(name({ Bolt: 1, "Bolt Foods Ltd": 4, "Bolt Labs Ltd": 4 }, "bolt.com"), "Bolt");
    assert.equal(name({ Qubit: 2, "Qubit Systems, LLC": 2, "Qubit Labs, LLC": 2, "Qubit Systems": 2 }, "qubit.com"), "Qubit");
  });

  it("a spelling that lowered the interior case of another never wins, whatever the counts", () => {
    assert.equal(name({ Novatx: 9, "NovaTX Inc": 2 }, "novatx.com"), "NovaTX");
    assert.equal(name({ Mediflow: 9, MediFlow: 1 }, "mediflow.com"), "MediFlow");
  });

  it("an all-capitals spelling has no interior case to lose (banners still lose to a cased spelling, never win by it)", () => {
    assert.equal(name({ "ACME WIDGETS": 5, "Acme Widgets": 1 }, "acmewidgets.com"), "Acme Widgets");
    assert.equal(name({ ZIPLY: 5 }, "ziply.com"), "Ziply");
  });

  it("regression: Duke Energy, CorroHealth (feed-flattened roots)", () => {
    assert.equal(name({ "Duke Energy Corp": 136, Dukeenergy: 57 }, "duke-energy.com"), "Duke Energy");
    assert.equal(name({ "CorroHealth Inc": 59, "CorroHealth Infotech Private Limited": 59, Corrohealth: 5 }, "corrohealth.com"), "CorroHealth");
  });
});

describe("R2 — a spaced-out acronym is one word and never the shown spelling", () => {
  it("a respelling may collapse the letter run (invented names)", () => {
    assert.equal(siteSpelling("X Y Z Labs", ["XYZ labs"], "xyzlabs.com"), "XYZ labs");
    assert.equal(siteSpelling("Q R Holdings", ["QR Holdings"], "qrholdings.com"), "QR Holdings");
  });

  it("the letter run never wins its group, however common", () => {
    const name = (tally: Record<string, number>, domain: string) => resolveCompanyName(rows(tally), domain).value;
    assert.equal(name({ "X Y Z  Labs": 9, "XYZ LABS": 1 }, "xyzlabs.com"), "XYZ Labs");
    assert.equal(name({ "Q R Holdings": 4, "QR Holdings": 1 }, "qrholdings.com"), "QR Holdings");
  });

  it("regression: APF entreprises", () => {
    assert.equal(siteSpelling("A P F Entreprises", ["APF entreprises"], "apf-entreprises.fr"), "APF entreprises");
  });

  it("a plain extra space is still a space", () => {
    assert.equal(siteSpelling("Sunlife", ["Sun Life"], "sunlife.com"), "Sun Life");
    assert.equal(siteSpelling("Sun Life", ["Sunlife"], "sunlife.com"), "Sun Life");
  });
});

describe("R3 — a respelling never lowers an acronym", () => {
  it("keeps a capitalised word of display (invented names)", () => {
    assert.equal(siteSpelling("ZED", ["Zed Corp"], "zed.com"), "ZED");
    assert.equal(siteSpelling("QX Systems", ["Qx Systems"], "qxsystems.com"), "QX Systems");
  });

  it("still re-cases a banner display, where the cased spelling is the point", () => {
    assert.equal(siteSpelling("ZEDWORKS", ["Zedworks"], "zedworks.com"), "Zedworks");
    assert.equal(siteSpelling("AIR LIQUIDE", ["Air Liquide"], "airliquide.com"), "Air Liquide");
  });

  it("still takes a respelling that lowers nothing capitalised", () => {
    assert.equal(siteSpelling("Naughtone", ["NaughtOne"], "naughtone.com"), "NaughtOne");
  });

  it("regression: FOX, ARK Systems", () => {
    assert.equal(siteSpelling("FOX", ["foxcorporation", "Fox Corporation"], "foxcorporation.com"), "FOX");
    assert.equal(siteSpelling("ARK Systems", ["Ark Systems Inc"], "arksysinc.com"), "ARK Systems");
  });
});

describe("R4 — title-casing a banner still lets the legal form strip", () => {
  it("displayCompanyName strips the legal form after the resolver title-cased the banner (invented names)", () => {
    const shown = (tally: Record<string, number>, domain: string) => displayCompanyName(resolveCompanyName(rows(tally), domain).value);
    assert.equal(shown({ "ACME WIDGETS CORP.": 3 }, "acmewidgets.com"), "Acme Widgets");
    assert.equal(shown({ "ZETA PHARMA INC": 3 }, "zetapharma.com"), "Zeta Pharma");
  });
});
