import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSuggestBody, dedupeJobSuggestionHits, stripGenderSuffixArtifact } from "../../src/lib/jobs/meilisearch";

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

test("dedupeJobSuggestionHits dedupes companies case-insensitively, capped at 2, and drops blank/null values", () => {
    const hits = [
        { title: "Engineer", company: "Acme Corp" },
        { title: "Engineer II", company: "acme corp" }, // dup of above (different case) — dropped
        { title: "Engineer III", company: "  " }, // blank after trim — dropped
        { title: "Engineer IV", company: null }, // null — dropped
        { title: "Engineer V", company: "Beta Corp" },
        { title: "Engineer VI", company: "Gamma Corp" }, // 3rd distinct company — beyond the cap, dropped
    ];

    const result = dedupeJobSuggestionHits(hits, "corp");

    assert.deepEqual(result.companies, ["Acme Corp", "Beta Corp"]);
    assert.equal(result.companies.length, 2);
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
        attributesToSearchOn: ["title", "company"],
        attributesToRetrieve: ["title", "company", "company_domain"],
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
