import { test } from "node:test";
import assert from "node:assert/strict";
import { titleMatchesQuery, firstMentionIndex, seamSummary } from "../../src/lib/jobs/presentation";

test("titleMatchesQuery: exact token match", () => {
    assert.equal(titleMatchesQuery("Technical Account Manager", "technical account manager"), true);
});

test("titleMatchesQuery: startsWith tolerance lets a plural title match a singular query", () => {
    assert.equal(titleMatchesQuery("Technical Account Managers", "technical account manager"), true);
});

test("titleMatchesQuery: 'c++' survives tokenization as one token", () => {
    assert.equal(titleMatchesQuery("Senior C++ Engineer", "c++ engineer"), true);
    assert.equal(titleMatchesQuery("Senior C Engineer", "c++ engineer"), false);
});

test("titleMatchesQuery: a place-stripped residual matches a title with no place word", () => {
    // The raw typed query still carries "canada" (query understanding strips
    // place tokens server-side, not client-side) — matching against it would
    // wrongly demote a title that never mentions the place at all.
    assert.equal(titleMatchesQuery("Technical Account Manager", "technical account manager canada"), false);
    // The server's residual (place token already removed) matches correctly.
    assert.equal(titleMatchesQuery("Technical Account Manager", "technical account manager"), true);
});

test("titleMatchesQuery: a title that only mentions the phrase, not titled with it, fails", () => {
    assert.equal(titleMatchesQuery("Data Centre Field Engineer", "technical account manager"), false);
});

test("titleMatchesQuery: empty query never matches", () => {
    assert.equal(titleMatchesQuery("Technical Account Manager", ""), false);
    assert.equal(titleMatchesQuery("Technical Account Manager", "   "), false);
});

test("firstMentionIndex: seam lands mid-list at the first non-matching title", () => {
    const titles = [
        "Technical Account Manager",
        "Technical Account Manager",
        "Data Centre Field Engineer",
        "Senior Account Manager",
    ];
    assert.equal(firstMentionIndex(titles, "technical account manager"), 2);
});

test("firstMentionIndex: -1 when the first title itself doesn't match (no titled block)", () => {
    const titles = ["Data Centre Field Engineer", "Technical Account Manager"];
    assert.equal(firstMentionIndex(titles, "technical account manager"), -1);
});

test("firstMentionIndex: -1 when every title matches", () => {
    const titles = ["Technical Account Manager", "Technical Account Managers"];
    assert.equal(firstMentionIndex(titles, "technical account manager"), -1);
});

test("firstMentionIndex: -1 for an empty query", () => {
    const titles = ["Technical Account Manager", "Data Centre Field Engineer"];
    assert.equal(firstMentionIndex(titles, ""), -1);
});

test("firstMentionIndex: -1 for an empty titles list", () => {
    assert.equal(firstMentionIndex([], "technical account manager"), -1);
});

test("seamSummary: counts both sides and pluralizes", () => {
    assert.equal(seamSummary(3, 30, 30), "3 roles are titled this · 27 more mention it");
});

test("seamSummary: singular titled-block reads as one role/is", () => {
    assert.equal(seamSummary(1, 6, 6), "1 role is titled this · 5 more mention it");
});

test("seamSummary: large counts format with thousands separators", () => {
    assert.equal(seamSummary(1234, 5678, 5678), "1,234 roles are titled this · 4,444 more mention it");
});

test("seamSummary: total undercounting the seam falls back to the loaded hits, never negative", () => {
    // Meili's raw total can undercount what's actually loaded (the same edge
    // case `resolveCorpusCount` guards against) — total(5) < seamIndex(10)
    // here, so this must fall back to hitsLength - seamIndex instead of
    // printing a negative remainder.
    assert.equal(seamSummary(10, 5, 14), "10 roles are titled this · 4 more mention it");
});

test("seamSummary: even the hits-length fallback never goes negative", () => {
    assert.equal(seamSummary(10, 5, 10), "10 roles are titled this · 0 more mention it");
});
