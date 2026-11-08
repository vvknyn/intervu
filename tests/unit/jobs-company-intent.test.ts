import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCompanyDomainPin,
  COMPANY_INTENT_MAX_TITLE_ECHO,
  COMPANY_INTENT_MIN_EXACT,
  COMPANY_INTENT_MIN_RATIO,
  companyNameStem,
  dominantCompanyDomains,
  employerDisplayName,
  extractCompoundRoleCompanyCandidates,
  isCompanyNameQuery,
  MAX_COMPANY_WORDS,
  normalizeCompanyName,
  pickCompoundEmployer,
  unresolvedCompoundSplit,
} from "../../src/lib/jobs/company-intent";
import { applyRelevanceQualityReranking } from "../../src/lib/jobs/meilisearch";
import type { PublicJob } from "../../src/lib/jobs/types";
import { COMPANY_PROBES } from "../fixtures/company-intent-probes";

/**
 * Every `companies` array below is a LIVE sample taken from the company
 * attribute on 2026-08-11 (`attributesToSearchOn: ["company"]`,
 * `matchingStrategy: "all"`), so these cases encode what the corpus actually
 * returns rather than an idealised fixture.
 */
const sample = (companies: string[], total = companies.length, domains: string[] = []) => ({
  total,
  companies,
  domains: domains.length > 0 ? domains : companies.map(() => ""),
});

test("company-name queries are detected — and not just the one that surfaced the bug", () => {
    // Deliberately NOT "stripe": the gate must be a property of the match
    // distribution, so any dominantly-named employer qualifies.
    assert.equal(isCompanyNameQuery("cloudflare", sample(Array(10).fill("Cloudflare"), 538)), true);
    assert.equal(isCompanyNameQuery("databricks", sample(Array(10).fill("Databricks"), 835)), true);
    assert.equal(isCompanyNameQuery("stripe", sample(Array(10).fill("Stripe"), 1021)), true);
    // An employer the corpus has never seen still works — nothing is enumerated.
    assert.equal(isCompanyNameQuery("Zynthara Robotics", sample(Array(8).fill("Zynthara Robotics"), 8)), true);
});

test("legal-suffix stems match indexed employer names", () => {
    assert.equal(
        isCompanyNameQuery("Tesla", sample(Array(8).fill("Tesla, Inc.").concat(Array(2).fill("Other Corp")), 100)),
        true,
    );
    assert.equal(
        isCompanyNameQuery("tesla", sample(Array(6).fill("Tesla Inc"), 50)),
        true,
    );
    assert.equal(
        isCompanyNameQuery("microsoft", sample(Array(10).fill("Microsoft Corporation"), 200)),
        true,
    );
    assert.equal(isCompanyNameQuery("stripe", sample(Array(10).fill("Stripe"), 1021)), true);
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

test("companyNameStem reuses displayCompanyName legal-suffix stripping", () => {
    assert.equal(companyNameStem("Tesla, Inc."), companyNameStem("Tesla"));
    assert.equal(companyNameStem("Microsoft Corporation"), companyNameStem("microsoft"));
});

test("dominantCompanyDomains returns qualifying domains from stem-matching hits", () => {
    const companies = [...Array(7).fill("Tesla, Inc."), ...Array(3).fill("Other Co")];
    const domains = [...Array(7).fill("tesla.com"), ...Array(3).fill("other.com")];
    const s = sample(companies, 100, domains);
    assert.deepEqual(dominantCompanyDomains("Tesla", s), ["tesla.com"]);
});

test("dominantCompanyDomains fails open when intent does not pass", () => {
    assert.deepEqual(
        dominantCompanyDomains("product manager", sample(["IT Product Manager (All Gender)"], 1)),
        [],
    );
});

test("dominantCompanyDomains fails open when domains are missing", () => {
    assert.deepEqual(
        dominantCompanyDomains("stripe", sample(Array(10).fill("Stripe"), 100)),
        [],
    );
});

/**
 * Live probes (tests/fixtures/company-intent-probes.ts, index as of 2026-10-12).
 * The index holds "companies" that are really a job-title fragment the scraper
 * split off ("Storekeeper - Warehouse" arrives with company "Warehouse"), so a
 * role word can dominate the company field exactly like an employer does.
 */
const probe = (q: string, withTitles = true) => {
    const { total, rows } = COMPANY_PROBES[q];
    return {
        total,
        companies: rows.map(([c]) => c),
        domains: rows.map(([, d]) => d),
        ...(withTitles && { titles: rows.map(([, , t]) => t) }),
    };
};
const verdict = (q: string) => isCompanyNameQuery(q, probe(q));

test("a role word that the index carries as a junk company is NOT a company query", () => {
    for (const q of ["warehouse", "mechanic", "production", "plumber"]) {
        assert.equal(
            isCompanyNameQuery(q, probe(q, false)),
            true,
            `${q}: dominance alone passes (the pre-fix verdict), so the title evidence is what has to reject it`,
        );
        assert.equal(verdict(q), false, `${q} stays a title search`);
    }
});

test("generic nouns that name rows AND titles are not company queries either", () => {
    // Not role words, but the same shape: every row that is "named" bank/healthcare
    // repeats the word in its own title.
    for (const q of ["bank", "healthcare"]) {
        assert.equal(verdict(q), false, q);
    }
});

test("role words whose company probe names nobody stay title searches", () => {
    for (const q of [
        "nurse", "cashier", "welder", "driver", "teacher", "retail", "server",
        "customer service", "electrician", "janitor", "forklift",
    ]) {
        assert.equal(verdict(q), false, q);
    }
});

test("real employers keep company intent — including a multi-word name", () => {
    const employers = [
        "shopify", "amazon", "rbc", "walmart", "stripe", "cloudflare", "deloitte", "microsoft",
        "jpmorgan chase", "google", "apple", "target", "starbucks", "telus", "dollarama",
        "uber", "salesforce", "netflix", "tesla", "cisco",
    ];
    assert.ok(employers.some((q) => q.includes(" ")), "at least one multi-word employer");
    for (const q of employers) {
        assert.equal(verdict(q), true, q);
    }
});

test("title evidence only ever withdraws company intent; it never grants it", () => {
    for (const q of Object.keys(COMPANY_PROBES)) {
        if (verdict(q)) assert.equal(isCompanyNameQuery(q, probe(q, false)), true, q);
    }
    // Employers the 10-row sample cannot establish stay as undecided as before.
    for (const q of ["cleveland clinic", "air canada"]) {
        assert.equal(verdict(q), isCompanyNameQuery(q, probe(q, false)), q);
    }
});

test("the title-echo threshold is enforced at its boundary", () => {
    const named = (echoed: number) => ({
        total: 100,
        companies: Array(10).fill("Acme Works"),
        domains: Array(10).fill("acme.com"),
        titles: Array.from({ length: 10 }, (_, i) => (i < echoed ? "Acme Works lead" : "Senior Analyst")),
    });
    const atLimit = COMPANY_INTENT_MAX_TITLE_ECHO * 10;
    assert.equal(isCompanyNameQuery("acme works", named(atLimit - 1)), true);
    assert.equal(isCompanyNameQuery("acme works", named(atLimit)), false);
    assert.equal(isCompanyNameQuery("acme works", named(10)), false);
});

test("a title repeats the query only when it carries every word of it", () => {
    const sampleOf = (titles: string[]) => ({
        total: 100,
        companies: Array(titles.length).fill("Acme Works"),
        domains: Array(titles.length).fill("acme.com"),
        titles,
    });
    assert.equal(isCompanyNameQuery("acme works", sampleOf(Array(10).fill("Acme Staff"))), true);
    assert.equal(isCompanyNameQuery("acme works", sampleOf(Array(10).fill("Works Supervisor at ACME"))), false);
});

test("no title evidence means no veto (dominance decides, as before)", () => {
    assert.equal(isCompanyNameQuery("warehouse", probe("warehouse", false)), true);
    const blank = { ...probe("warehouse", false), titles: Array(10).fill("") };
    assert.equal(isCompanyNameQuery("warehouse", blank), true);
});

test("extractCompoundRoleCompanyCandidates decomposes [Role] + [Company] queries without touching pure roles", () => {
    assert.deepEqual(extractCompoundRoleCompanyCandidates("Product Manager tesla"), [
        { roleQ: "Product Manager", companyQ: "tesla" },
    ]);
    // A role word next to the name may belong to either: the longer name is asked first, and
    // the corpus keeps only the split whose employer it knows (`pickCompoundEmployer`).
    assert.deepEqual(extractCompoundRoleCompanyCandidates("tesla Product Manager"), [
        { roleQ: "Manager", companyQ: "tesla Product" },
        { roleQ: "Product Manager", companyQ: "tesla" },
    ]);
    assert.deepEqual(extractCompoundRoleCompanyCandidates("Product Manager at Tesla"), [
        { roleQ: "Product Manager", companyQ: "Tesla" },
    ]);
    assert.deepEqual(extractCompoundRoleCompanyCandidates("Product Manager jpmorgan chase"), [
        { roleQ: "Product Manager", companyQ: "jpmorgan chase" },
    ]);
    assert.deepEqual(extractCompoundRoleCompanyCandidates("product manager"), []);
    assert.deepEqual(extractCompoundRoleCompanyCandidates("registered nurse"), []);
    assert.deepEqual(extractCompoundRoleCompanyCandidates("senior software engineer"), []);
    assert.deepEqual(
        applyCompanyDomainPin(
            { q: "Product Manager tesla" },
            { companyScoped: false, companyDomains: ["tesla.com"], residualRoleQ: "Product Manager" },
        ),
        { q: "Product Manager", companyDomain: "tesla.com" },
    );
});

test("applyRelevanceQualityReranking demotes 1-typo company false positives (Tekla/Tesat for Tesla) and foreign titles", () => {
    const teklaHit = {
        id: "tekla",
        title: "Customer Support Manager",
        company: "Trimble Tekla",
        ghost_badge: "clear",
        posted_ts: 3000,
    } as PublicJob;
    const dutchHit = {
        id: "dutch",
        title: "Senior Product Specialist technisch beheer",
        company: "Werkenvoornederland",
        ghost_badge: "clear",
        posted_ts: 4000,
    } as PublicJob;
    const realPmHit = {
        id: "real-pm",
        title: "Product Manager, Energy",
        company: "Tesla",
        ghost_badge: "clear",
        posted_ts: 1000,
    } as PublicJob;

    const ranked = applyRelevanceQualityReranking([teklaHit, dutchHit, realPmHit], "Product Manager tesla");
    assert.equal(ranked[0]?.id, "real-pm");
});

/**
 * Vivek, 2026-11-08: "searching product manager integral ad science should search for product manager jobs in that
 * company". The split only took employer names of one or two words with no role word in them, so "Integral Ad
 * Science" (three words, "science" is a role word), "Capital One", "Bank of America" and "Johnson & Johnson" were
 * never read as an employer. Measured over 3,535 employer names from the Built In list × 3 roles × 3 word orders
 * (31,815 queries): the old rule split 72.5%, this one 97.6%. The class, not the example: every name shape below, in
 * every word order, with several roles.
 */
const NAME_SHAPES = [
    "Integral Ad Science", // three words, one a role word
    "Capital One", // a role-looking word first? no: "capital" is plain, "one" is plain
    "Bank of America", // a connector inside
    "Johnson & Johnson", // a bare "&" inside
    "Health Canada", // a role word ("health") first
    "Data Robot", // a role word ("data") first
    "Zynthara", // one plain word
    "Royal Bank of Canada", // four words
];
const ROLES = ["product manager", "senior data scientist", "registered nurse", "software engineer"];

for (const name of NAME_SHAPES) {
    test(`a role + employer query splits out "${name}" in every word order`, () => {
        for (const role of ROLES) {
            for (const q of [`${role} ${name}`, `${name} ${role}`, `${role} at ${name}`]) {
                const splits = extractCompoundRoleCompanyCandidates(q);
                const right = splits.find((c) => normalizeCompanyName(c.companyQ) === normalizeCompanyName(name));
                assert.ok(right, `${q} -> ${JSON.stringify(splits)}`);
                assert.equal(normalizeCompanyName(right.roleQ), normalizeCompanyName(role), q);
            }
        }
    });
}

test("an employer name may not start or end with a connector, run past four words, or be only role words", () => {
    assert.equal(MAX_COMPANY_WORDS, 4);
    // "of" can neither end the role ("product manager of") nor start the name ("of america").
    assert.deepEqual(extractCompoundRoleCompanyCandidates("product manager of america"), []);
    assert.deepEqual(extractCompoundRoleCompanyCandidates("product manager acme widgets north east"), [
        { roleQ: "product manager", companyQ: "acme widgets north east" },
    ]);
    assert.deepEqual(extractCompoundRoleCompanyCandidates("product manager acme widgets north east west"), []);
    // Only role words: a role search, never an employer probe.
    assert.deepEqual(extractCompoundRoleCompanyCandidates("senior data science product manager"), []);
});

const employerSample = (name: string, domain: string, n = 6) => ({
    total: n,
    companies: Array(n).fill(name),
    domains: Array(n).fill(domain),
    titles: Array(n).fill("Account Executive"),
});
const empty = { total: 0, companies: [], domains: [], titles: [] };

test("the corpus decides the split: the first split whose employer it knows wins, with that employer's name", () => {
    const candidates = extractCompoundRoleCompanyCandidates("integral ad science product manager");
    // Longest name first: "integral ad science product" / "integral ad science" / "integral ad".
    assert.deepEqual(candidates.map((c) => c.companyQ), ["integral ad science product", "integral ad science", "integral ad"]);
    const samples = candidates.map((c) =>
        normalizeCompanyName(c.companyQ) === "integral ad science" ? employerSample("Integral Ad Science, Inc.", "integralads.com") : empty,
    );
    assert.deepEqual(pickCompoundEmployer(candidates, samples), {
        roleQ: "product manager",
        companyQ: "integral ad science",
        domains: ["integralads.com"],
        name: "Integral Ad Science",
    });
    // No employer by any of those names: nothing is pinned.
    assert.equal(pickCompoundEmployer(candidates, candidates.map(() => empty)), null);
});

test("an employer with too few rows of that exact name is not read as one (same floors as a bare employer search)", () => {
    const candidates = extractCompoundRoleCompanyCandidates("product manager acme");
    assert.equal(pickCompoundEmployer(candidates, [employerSample("Acme", "acme.com", COMPANY_INTENT_MIN_EXACT - 1)]), null);
    assert.equal(pickCompoundEmployer(candidates, [employerSample("Acme", "acme.com", COMPANY_INTENT_MIN_EXACT)])?.domains[0], "acme.com");
});

test("with no employer found, the split with the most role words is the one named as not found", () => {
    assert.deepEqual(unresolvedCompoundSplit(extractCompoundRoleCompanyCandidates("tesla product manager")), {
        roleQ: "product manager",
        companyQ: "tesla",
    });
    assert.deepEqual(unresolvedCompoundSplit(extractCompoundRoleCompanyCandidates("product manager integral ad science")), {
        roleQ: "product manager",
        companyQ: "integral ad science",
    });
    assert.equal(unresolvedCompoundSplit([]), null);
});

test("employerDisplayName reads the display form of the row whose name IS the query", () => {
    assert.equal(employerDisplayName("acme", { total: 2, companies: ["Acme Robotics", "Acme, Inc."], domains: ["", ""] }), "Acme");
    assert.equal(employerDisplayName("acme", { total: 1, companies: ["Acme Robotics"], domains: [""] }), undefined);
});
