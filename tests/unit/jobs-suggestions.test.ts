import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildEmployerSuggestBody,
    buildEmployerSuggestions,
    buildSuggestBody,
    dedupeJobSuggestionHits,
    EMPLOYER_SUGGEST_CAP,
    employerSuggestQueries,
    mergeEmployerSuggestions,
    JOBS_INDEX_SETTINGS,
    stripGenderSuffixArtifact,
} from "../../src/lib/jobs/meilisearch";

test("dedupeJobSuggestionHits dedupes titles case-insensitively, capped at 5, first casing wins", () => {
    const hits = [
        { title: "Software Engineer", company: "Acme" },
        { title: "software engineer", company: "Acme" }, // dup of above (different case) — dropped
        { title: "Senior Software Engineer", company: "Beta" },
        { title: "Staff Engineer", company: "Gamma" },
        { title: "Principal Engineer", company: "Delta" },
        { title: "Engineering Manager", company: "Epsilon" },
        { title: "Site Reliability Engineer", company: "Zeta" }, // 6th distinct title — beyond the cap, dropped
    ];

    const result = dedupeJobSuggestionHits(hits, "engineer");

    assert.deepEqual(result.titles, [
        "Software Engineer",
        "Senior Software Engineer",
        "Staff Engineer",
        "Principal Engineer",
        "Engineering Manager",
    ]);
    assert.equal(result.titles.length, 5);
});

// Fixture refreshed 2026-08-29 (corp-suffix audit). This case used to query
// "corp" and expect "Acme Corp"/"Beta Corp" back verbatim — the shared query
// token AND the expected output were both the legal suffix. Now that bare
// "Corp" strips at display time (`BARE_LEGAL_SUFFIXES`, presentation.ts) and
// `dedupeJobSuggestionHits` cleans BEFORE its relevance check
// (meilisearch.ts: `displayCompanyBrand(...)` then `titleMatchesQuery`), no
// cleaned brand contains "corp" and every row is correctly dropped. What
// this test is ABOUT is unchanged — case-insensitive dedupe, the cap of 2,
// blank/null rejection; only the token the fixture shares moved from the
// suffix onto the brand, which is what a user actually types.
test("dedupeJobSuggestionHits dedupes companies case-insensitively, capped at 2, and drops blank/null values", () => {
    const hits = [
        { title: "Engineer", company: "Northwind Corp" },
        { title: "Engineer II", company: "northwind corp" }, // dup of above (different case) — dropped
        { title: "Engineer III", company: "  " }, // blank after trim — dropped
        { title: "Engineer IV", company: null }, // null — dropped
        { title: "Engineer V", company: "Northwind Labs Corp" },
        { title: "Engineer VI", company: "Northwind Data Corp" }, // 3rd distinct company — beyond the cap, dropped
    ];

    const result = dedupeJobSuggestionHits(hits, "northwind");

    assert.deepEqual(result.companies, ["Northwind", "Northwind Labs"]);
    assert.equal(result.companies.length, 2);
});

// The behavioural half of the same change, and the reason the fixture above
// had to move: a bare legal designator must no longer pull in companies
// whose ONLY tie to the query is the suffix display-time cleaning removes.
// "Corp" is not a brand, so "Northwind Corp" is not a "corp" result.
// Asserted for a second designator ("Ltd") as well — this is a property of
// the whole widened tier, not of the one token that surfaced it.
test("dedupeJobSuggestionHits does not suggest a company whose only tie to the query is a stripped legal suffix", () => {
    const hits = [
        { title: "Engineer", company: "Northwind Corp" },
        { title: "Engineer II", company: "Southwind Ltd" },
    ];

    assert.deepEqual(dedupeJobSuggestionHits(hits, "corp").companies, []);
    assert.deepEqual(dedupeJobSuggestionHits(hits, "ltd").companies, []);
});

// 2026-08-21 front-door audit, item 6b: live prod suggested "Phsorg",
// "Glance", and an ATS-portal string as companies for a "product manager"
// query — every one of them came from a hit whose TITLE matched, not a
// company that had anything to do with what was typed.
test("dedupeJobSuggestionHits only suggests a company that itself relates to q — a title-only match doesn't pull an unrelated company along", () => {
    const hits = [
        { title: "Product Manager", company: "Extendicare" },
        { title: "Senior Product Manager", company: "Greystar" },
    ];
    const result = dedupeJobSuggestionHits(hits, "product manager");
    assert.deepEqual(result.companies, []);
});

test("dedupeJobSuggestionHits still suggests a company whose own name relates to q", () => {
    const hits = [{ title: "Registered Nurse", company: "Acme Health" }];
    const result = dedupeJobSuggestionHits(hits, "acme");
    assert.deepEqual(result.companies, ["Acme Health"]);
});

// Item 6d: a company value that's just its own domain with separators
// stripped ("phs.org" -> "Phsorg") is ingestion-side junk, not an asserted
// name — repaired via the same domain-humanizing path every other
// ATS-tenant-domain name goes through, or dropped when there's no domain on
// the hit to repair it from.
test("dedupeJobSuggestionHits repairs a company name that's just its own domain squashed together", () => {
    const hits = [{ title: "Nurse", company: "Phsorg", company_domain: "phs.org" }];
    const result = dedupeJobSuggestionHits(hits, "phs");
    assert.deepEqual(result.companies, ["Phs"]);
});

test("dedupeJobSuggestionHits leaves a company name unrepaired when the hit carries no domain to confirm a squash against", () => {
    const hits = [{ title: "Nurse", company: "Phsorg" }];
    const result = dedupeJobSuggestionHits(hits, "phs");
    // No `company_domain` on the hit means there's nothing to compare
    // against, so this can't be confirmed as domain-derived junk — it falls
    // through to the ordinary relevance check like any other company text
    // and still passes it ("phsorg" starts with "phs").
    assert.deepEqual(result.companies, ["Phsorg"]);
});

// 2026-08-20: live prod suggested "Product Manager:in" — a German
// gender-neutral-suffix scrape artifact riding along on a title copied
// verbatim from a German-language source. Covers a SECOND artifact form
// ("Entwickler:innen") too, not just the reported instance — same rule, two
// suffixes, so the fix is proven class-wide rather than a literal patch for
// the one string that got noticed.
test("stripGenderSuffixArtifact strips the German gender-suffix scrape artifact, any of the closed suffix set", () => {
    assert.equal(stripGenderSuffixArtifact("Product Manager:in"), "Product Manager");
    assert.equal(stripGenderSuffixArtifact("Entwickler:innen"), "Entwickler");
    assert.equal(stripGenderSuffixArtifact("Lehrer:r"), "Lehrer");
    assert.equal(stripGenderSuffixArtifact("Student:e"), "Student");
});

test("stripGenderSuffixArtifact leaves an ordinary title untouched", () => {
    assert.equal(stripGenderSuffixArtifact("Software Engineer"), "Software Engineer");
    // A colon NOT at the end, or not followed by one of the closed suffixes,
    // is just punctuation in the title — not the scrape artifact.
    assert.equal(stripGenderSuffixArtifact("Senior: Backend Engineer"), "Senior: Backend Engineer");
});

test("dedupeJobSuggestionHits strips the gender-suffix artifact from both title and company before dedupe/cap", () => {
    const result = dedupeJobSuggestionHits(
        [
            { title: "Product Manager:in", company: "Acme Systems" },
            { title: "Entwickler:innen", company: "Beta Systems:in" },
        ],
        "systems",
    );
    assert.deepEqual(result.titles, ["Product Manager", "Entwickler"]);
    assert.deepEqual(result.companies, ["Acme Systems", "Beta Systems"]);
});

// Company-name seam rework (2026-08-29): the index carries the ATS-stated
// raw name (intervu owns display-time cleaning, not ingest — the sync that
// writes the live index lives in a separate repo and PUTs the feed through
// unchanged), so this dedupe/label step is the typeahead's ONE chokepoint
// for cleaning, not a leftover from an ingest-time seam. Cleaner-algorithm
// coverage itself (hostname strip, legal suffix, slogan/brand split,
// idempotency) lives in jobs-company-clean.test.ts against displayCompanyBrand
// directly — these two cases prove THIS surface actually calls it, and that
// cleaning happens before the dedupe key so near-duplicate raw strings
// collapse into one suggestion instead of three.
test("dedupeJobSuggestionHits cleans company text before dedupe/cap — a REQ-prefixed and a legal-suffixed raw name for the same company collapse to one cleaned suggestion", () => {
    const result = dedupeJobSuggestionHits(
        [
            { title: "Engineer", company: "REQ123 Acme" },
            { title: "Engineer II", company: "Acme, Inc." },
        ],
        "acme",
    );
    assert.deepEqual(result.companies, ["Acme"]);
});

test("dedupeJobSuggestionHits prefers the domain-corroborated brand tail of a '{slogan} - {brand}' raw name", () => {
    const result = dedupeJobSuggestionHits(
        [{ title: "Recruiter", company: "We build great things - Acme", company_domain: "acme.com" }],
        "acme",
    );
    assert.deepEqual(result.companies, ["Acme"]);
});

// 2026-08-14: the typeahead's request body moved off hitsPerPage (forces
// Meili's exhaustive-count pagination engine) + unscoped search (description
// text feeds suggestions) — measured live 0.62s cold / ~0.1s warm — onto
// limit + attributesToSearchOn:["title","company"] — 0.15s cold / ~0.08s
// warm. Pinned as a pure body-shape assertion (no fetch mock needed) so a
// future edit can't silently regress either half of the fix.
test("buildSuggestBody scopes matching to title+company and uses `limit`, never `hitsPerPage`", () => {
    const body = buildSuggestBody("engineer");

    assert.deepEqual(body, {
        q: "engineer",
        limit: 20,
        matchingStrategy: "all",
        attributesToSearchOn: ["title", "company"],
        attributesToRetrieve: ["title", "company", "company_domain"],
        distinct: "title",
    });
    assert.ok(!("hitsPerPage" in body), "hitsPerPage forces exhaustive-count pagination — must not reappear");
});

// The short-token prefix-explosion fix (`quoteShortTokens`, meilisearch.ts)
// applies ONLY to `buildSearchBody` (a submitted search) — never here. A
// user still typing "produc" needs prefix matching to keep suggesting
// "Product Manager"; phrase-quoting a mid-word typeahead token would break
// autocomplete outright.
test("buildSuggestBody never quotes short tokens — typeahead keeps prefix matching", () => {
    const body = buildSuggestBody("tam");
    assert.equal(body.q, "tam");
});

// 2026-08-24: `manager`/`nurse`/`software engineer` — common exact job
// titles — collapsed the typeahead to ONE suggestion, because every one of
// Meili's top hits was a different document with the identical title (the
// query's unit is documents, not distinct titles). Fix is `distinct:
// "title"` on the suggest body. Covers the collapsing case AND a
// non-collapsing one AND an odd query — `distinct` must be unconditional,
// never special-cased per query string, or a future edit could silently
// scope it to just the reported instance.
for (const q of ["manager", "user experience", "  ", ""]) {
    test(`buildSuggestBody(${JSON.stringify(q)}) always sets distinct: "title" alongside the existing shape`, () => {
        const body = buildSuggestBody(q);
        assert.equal(body.distinct, "title");
        assert.equal(body.limit, 20);
        assert.deepEqual(body.attributesToSearchOn, ["title", "company"]);
        assert.deepEqual(body.attributesToRetrieve, ["title", "company", "company_domain"]);
    });
}

// The generic guard: this is the SECOND dependency of the "code declares a
// setting the live index doesn't carry" shape (`id` in filterableAttributes
// 400'd for six days before the index caught up — see the comment above
// `"id"` in JOBS_INDEX_SETTINGS). Asserts the INVARIANT — whatever
// `buildSuggestBody` sets as `distinct` must be a filterable attribute — not
// the instance, so a future change to either side that breaks the pairing
// fails this test instead of shipping a live 400.
test("buildSuggestBody's distinct attribute is declared filterable in JOBS_INDEX_SETTINGS", () => {
    const { distinct } = buildSuggestBody("engineer");
    assert.ok(distinct, "buildSuggestBody must set a distinct attribute");
    assert.ok(
        JOBS_INDEX_SETTINGS.filterableAttributes.includes(distinct as string),
        `distinct attribute "${distinct}" must be a member of JOBS_INDEX_SETTINGS.filterableAttributes or Meili 400s the suggest query`,
    );
});

/**
 * Vivek, 2026-11-08: "I'm not seeing faceted type ahead results in the search bar" — "integral ad science" listed
 * only a Roles section ("Integral Project Manager", "Integral Life Product Development, Consultant", ...). Two causes,
 * each a class: (1) the title search dropped typed words from the end until a title matched, so a role holding none of
 * "ad science" was suggested; (2) employers came only from those 20 title-ranked rows, so an employer whose name
 * shares a word with many titles never reached them. The tests below pin both for any query, not the one example.
 */
test("every typed word must be in a role suggestion: the title search asks for all of them", () => {
    for (const q of ["integral ad science", "product manager", "capital one", "registered nurse toronto"]) {
        assert.equal(buildSuggestBody(q).matchingStrategy, "all", q);
    }
});

test("employers come from a search of the employer names themselves, one row per employer, live roles only", () => {
    const body = buildEmployerSuggestBody("integral ad science");
    assert.deepEqual(body.attributesToSearchOn, ["company"]);
    assert.equal(body.matchingStrategy, "all");
    assert.equal(body.distinct, "company_domain");
    assert.ok(body.filter.some((clause) => /vacancy/i.test(clause)), `live roles only: ${JSON.stringify(body.filter)}`);
    // An index that refuses `distinct` on the domain is asked again without it, for more rows, folded here.
    const plain = buildEmployerSuggestBody("integral ad science", false);
    assert.equal(plain.distinct, undefined);
    assert.ok(plain.limit > body.limit);
});

test("employer rows show the list's name, need every typed word at a word start, one per domain, and never lack a domain", () => {
    const rows = buildEmployerSuggestions(
        [
            { company: "Integral Ad Science, Inc.", company_domain: "integralads.com", title: "Account Executive" },
            { company: "Integral Ad Science", company_domain: "integralads.com", title: "Analyst" }, // same domain
            { company: "Integral Ad Science EMEA", company_domain: null, title: "Analyst" }, // no domain to filter on
            { company: "Science Integral Labs", company_domain: "sil.example", title: "Chemist" }, // "ad" starts no word
            { company: "integraladscience", company_domain: "integraladscience.com", title: "Engineer" }, // squashed domain name
        ],
        "integral ad science",
    );
    assert.deepEqual(rows.map((r) => [r.name, r.domain]), [
        ["Integral Ad Science", "integralads.com"],
    ]);
    // A prefix still being typed matches.
    assert.deepEqual(buildEmployerSuggestions([{ company: "Shopify", company_domain: "shopify.com" }], "shop"), [
        { name: "Shopify", domain: "shopify.com" },
    ]);
    // The role read with the employer rides on the row.
    assert.deepEqual(buildEmployerSuggestions([{ company: "Shopify", company_domain: "shopify.com" }], "shop", "product manager"), [
        { name: "Shopify", domain: "shopify.com", role: "product manager" },
    ]);
});

test("one typed query asks for its whole text as an employer name, then the employer half of each role + employer reading", () => {
    assert.deepEqual(employerSuggestQueries("integral ad science"), [{ companyQ: "integral ad science" }]);
    assert.deepEqual(employerSuggestQueries("product manager shop"), [
        { companyQ: "product manager shop" },
        { companyQ: "shop", role: "product manager" },
    ]);
    assert.deepEqual(employerSuggestQueries("  "), []);
});

test("employers lead the box when the words name one or read as role + employer; otherwise roles lead", () => {
    const shopify = { name: "Shopify", domain: "shopify.com" };
    // The whole text IS an employer's name.
    assert.equal(mergeEmployerSuggestions("shopify", [[shopify]]).employersFirst, true);
    assert.equal(mergeEmployerSuggestions("Integral Ad Science", [[{ name: "Integral Ad Science", domain: "integralads.com" }]]).employersFirst, true);
    // A prefix of a name: roles ("Shop Assistant") may be what is meant, so they lead.
    assert.equal(mergeEmployerSuggestions("shop", [[shopify]]).employersFirst, false);
    // Role + employer words: the employer row is the reading.
    assert.equal(mergeEmployerSuggestions("product manager shop", [[], [{ ...shopify, role: "product manager" }]]).employersFirst, true);
    // One row per employer across the searches, whole text first, capped.
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `Acme ${i}`, domain: `acme${i}.com` }));
    const merged = mergeEmployerSuggestions("acme", [many.slice(0, 2), [many[1], ...many.slice(2)]]);
    assert.deepEqual(merged.employers.map((e) => e.domain), many.slice(0, EMPLOYER_SUGGEST_CAP).map((e) => e.domain));
});
