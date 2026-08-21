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

    const result = dedupeJobSuggestionHits(hits);

    assert.deepEqual(result.titles, [
        "Software Engineer",
        "Senior Software Engineer",
        "Staff Engineer",
        "Principal Engineer",
        "Engineering Manager",
    ]);
    assert.equal(result.titles.length, 5);
});

test("dedupeJobSuggestionHits dedupes companies case-insensitively, capped at 3, and drops blank/null values", () => {
    const hits = [
        { title: "Engineer", company: "Acme Inc" },
        { title: "Engineer II", company: "acme inc" }, // dup of above (different case) — dropped
        { title: "Engineer III", company: "  " }, // blank after trim — dropped
        { title: "Engineer IV", company: null }, // null — dropped
        { title: "Engineer V", company: "Beta Corp" },
        { title: "Engineer VI", company: "Gamma LLC" },
        { title: "Engineer VII", company: "Delta Co" }, // 4th distinct company — beyond the cap, dropped
    ];

    const result = dedupeJobSuggestionHits(hits);

    assert.deepEqual(result.companies, ["Acme Inc", "Beta Corp", "Gamma LLC"]);
    assert.equal(result.companies.length, 3);
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
    const result = dedupeJobSuggestionHits([
        { title: "Product Manager:in", company: "Acme" },
        { title: "Entwickler:innen", company: "Beta:in" },
    ]);
    assert.deepEqual(result.titles, ["Product Manager", "Entwickler"]);
    assert.deepEqual(result.companies, ["Acme", "Beta"]);
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
        attributesToRetrieve: ["title", "company"],
    });
    assert.ok(!("hitsPerPage" in body), "hitsPerPage forces exhaustive-count pagination — must not reappear");
});
