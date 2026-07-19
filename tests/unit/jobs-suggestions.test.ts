import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeJobSuggestionHits } from "../../src/lib/jobs/meilisearch";

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
