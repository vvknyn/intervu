import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPANY_INTENT_MIN_EXACT,
  COMPANY_INTENT_MIN_RATIO,
  isCompanyNameQuery,
  normalizeCompanyName,
} from "../../src/lib/jobs/company-intent";

/**
 * Every `companies` array below is a LIVE sample taken from the company
 * attribute on 2026-08-11 (`attributesToSearchOn: ["company"]`,
 * `matchingStrategy: "all"`), so these cases encode what the corpus actually
 * returns rather than an idealised fixture.
 */
const sample = (companies: string[], total = companies.length) => ({ total, companies });

test("company-name queries are detected — and not just the one that surfaced the bug", () => {
    // Deliberately NOT "stripe": the gate must be a property of the match
    // distribution, so any dominantly-named employer qualifies.
    assert.equal(isCompanyNameQuery("cloudflare", sample(Array(10).fill("Cloudflare"), 538)), true);
    assert.equal(isCompanyNameQuery("databricks", sample(Array(10).fill("Databricks"), 835)), true);
    assert.equal(isCompanyNameQuery("stripe", sample(Array(10).fill("Stripe"), 1021)), true);
    // An employer the corpus has never seen still works — nothing is enumerated.
    assert.equal(isCompanyNameQuery("Zynthara Robotics", sample(Array(8).fill("Zynthara Robotics"), 8)), true);
});

test("role queries are NOT company queries, even though a company matches every word", () => {
    // This is the whole reason `probeCompanyMatch`'s boolean cannot be the
    // gate: each of these returns hits on the company attribute live.
    assert.equal(
        isCompanyNameQuery("product manager", sample(["IT Product Manager (All Gender)"], 1)),
        false,
    );
    assert.equal(
        isCompanyNameQuery("software engineer", sample(Array(10).fill("Software Engineering"), 34)),
        false,
        "'Software Engineering' contains both words but is not the query",
    );
    assert.equal(
        isCompanyNameQuery(
            "accountant",
            sample(["Accountant II or Accountant III", "PwC Accountants N.V.", "PwC Accountants N.V."], 91),
        ),
        false,
    );
});

test("a lone junk employer named after a role never triggers company scoping", () => {
    // Live: exactly one company is literally called "Registered Nurse". A 1/2
    // sample is a 0.5 ratio AND below the exact-count floor — both reject it.
    assert.equal(
        isCompanyNameQuery("registered nurse", sample(["Registered Nurse", "Registered Nurse (RN)"], 2)),
        false,
    );
    // Even a PERFECT ratio is rejected below the exact-count floor, which is
    // the degenerate case the floor exists for.
    assert.equal(isCompanyNameQuery("data analyst", sample(["Data Analyst"], 1)), false);
    assert.equal(
        isCompanyNameQuery("data analyst", sample(["Data Analyst", "Data analyst and customer support"], 4)),
        false,
    );
});

test("the dominance thresholds are enforced at their boundaries", () => {
    const exact = (n: number, of: number) =>
        sample([...Array(n).fill("Acme Health"), ...Array(of - n).fill("Acme Health Staffing Partners")]);
    // Ratio floor: 5/10 is below 0.6, 6/10 meets it.
    assert.equal(isCompanyNameQuery("acme health", exact(5, 10)), false);
    assert.equal(isCompanyNameQuery("acme health", exact(6, 10)), true);
    // Exact-count floor sits above a bare majority of a tiny sample.
    assert.equal(isCompanyNameQuery("acme health", exact(COMPANY_INTENT_MIN_EXACT - 1, 2)), false);
    assert.equal(isCompanyNameQuery("acme health", exact(COMPANY_INTENT_MIN_EXACT, 3)), true);
    assert.ok(COMPANY_INTENT_MIN_RATIO > 0.5, "a bare majority must not be enough");
});

test("empty and unmatched probes fail open to the normal whole-document search", () => {
    assert.equal(isCompanyNameQuery("", sample(Array(10).fill(""))), false);
    assert.equal(isCompanyNameQuery("   ", sample(Array(10).fill("Stripe"))), false);
    assert.equal(isCompanyNameQuery("marketing manager", sample([], 0)), false);
    assert.equal(isCompanyNameQuery("stripe software engineer", sample([], 0)), false);
});

test("company names compare case-, punctuation- and spacing-insensitively", () => {
    assert.equal(normalizeCompanyName("Cleveland  Clinic"), "cleveland clinic");
    assert.equal(normalizeCompanyName("PwC Accountants N.V."), "pwc accountants n v");
    assert.equal(isCompanyNameQuery("CLEVELAND CLINIC", sample(Array(6).fill("Cleveland Clinic"), 101)), true);
    // A longer, differently-named subsidiary is NOT the same employer string.
    assert.equal(
        isCompanyNameQuery("cleveland clinic", sample(Array(10).fill("Cleveland Clinic Florida"), 101)),
        false,
    );
});
