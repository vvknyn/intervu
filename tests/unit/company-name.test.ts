import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brandTokens, resolveCompanyName } from "@/lib/companies/company-name";
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

  it("displays the root VERBATIM when the root's own name ends in a legal form (pharm-int.com, live)", () => {
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
    const resolved = resolveCompanyName(jobs, "pharm-int.com");
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
    assert.equal(resolved.value, "HITACHI ENERGY LTD");
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
        "constellation.com",
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
});
