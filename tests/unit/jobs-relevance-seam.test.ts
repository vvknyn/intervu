import { test } from "node:test";
import assert from "node:assert/strict";
import { titleMatchesQuery, firstMentionIndex } from "../../src/lib/jobs/presentation";

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
