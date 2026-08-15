import { test } from "node:test";
import assert from "node:assert/strict";
import {
    titleMatchesQuery,
    firstMentionIndex,
    partitionByTitleMatch,
    seamSummary,
    seamSummarySorted,
} from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

let seq = 0;
function job(overrides: Partial<PublicJob> = {}): PublicJob {
    seq += 1;
    return {
        id: `job-${seq}`,
        title: "Product Manager",
        company: "Acme Inc.",
        company_domain: "acme.com",
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "remote",
        description: null,
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://example.com/apply",
        source: "greenhouse",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "unscored",
        ...overrides,
    };
}

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

// partitionByTitleMatch — the sorted-mode seam. Under an explicit sort
// (fresh, salary) title and non-title hits interleave in engine order (a
// typo-tolerant near-miss like "Produce Manager" lands wherever ITS date
// puts it, not after the real title matches), so `firstMentionIndex`'s
// leading-run count stops at the first interloper instead of finding the
// true boundary. `partitionByTitleMatch` restores it by reordering.

test("partitionByTitleMatch: fresh-mode interleaving — titled hits move to one stable block ahead of non-titled", () => {
    const pm1 = job({ id: "pm-1", title: "Product Manager" });
    const pm2 = job({ id: "pm-2", title: "Product Manager" });
    const produce1 = job({ id: "produce-1", title: "Produce Manager" });
    const pm3 = job({ id: "pm-3", title: "Product Manager" });
    const produce2 = job({ id: "produce-2", title: "Produce Manager" });
    const pm4 = job({ id: "pm-4", title: "Product Manager" });
    // Raw engine (date) order: PM, PM, Produce, PM, Produce, PM.
    const { hits, seamIndex } = partitionByTitleMatch(
        [pm1, pm2, produce1, pm3, produce2, pm4],
        "product manager",
    );
    assert.equal(seamIndex, 4);
    assert.deepEqual(
        hits.map((h) => h.id),
        ["pm-1", "pm-2", "pm-3", "pm-4", "produce-1", "produce-2"],
        "stable partition: each block keeps its original relative (date-sorted) order",
    );
});

test("partitionByTitleMatch: -1 when every hit is titled — no seam, the whole page IS the titled block", () => {
    const hits = [job({ title: "Product Manager" }), job({ title: "Senior Product Manager" })];
    const result = partitionByTitleMatch(hits, "product manager");
    assert.equal(result.seamIndex, -1);
    assert.deepEqual(result.hits, hits);
});

test("partitionByTitleMatch: -1 when nothing is titled — no titled block to draw a seam under", () => {
    const hits = [job({ title: "Produce Manager" }), job({ title: "Warehouse Lead" })];
    const result = partitionByTitleMatch(hits, "product manager");
    assert.equal(result.seamIndex, -1);
    assert.deepEqual(result.hits, hits);
});

test("partitionByTitleMatch: -1 for an empty query, hits returned unchanged", () => {
    const hits = [job({ title: "Product Manager" }), job({ title: "Produce Manager" })];
    const result = partitionByTitleMatch(hits, "   ");
    assert.equal(result.seamIndex, -1);
    assert.deepEqual(result.hits, hits);
});

test("partitionByTitleMatch: order-agnostic — a differently-ordered input (e.g. salary_desc) partitions the same way", () => {
    // Proves the function isn't secretly tied to date order: feed it a
    // completely different engine ordering (as salary_desc sort would
    // produce) and it still separates cleanly into the same two blocks,
    // each preserving ITS OWN input order.
    const produce1 = job({ id: "produce-1", title: "Produce Manager" });
    const pm1 = job({ id: "pm-1", title: "Product Manager" });
    const pm2 = job({ id: "pm-2", title: "Product Manager" });
    const produce2 = job({ id: "produce-2", title: "Produce Manager" });
    const pm3 = job({ id: "pm-3", title: "Product Manager" });
    const { hits, seamIndex } = partitionByTitleMatch(
        [produce1, pm1, pm2, produce2, pm3],
        "product manager",
    );
    assert.equal(seamIndex, 3);
    assert.deepEqual(hits.map((h) => h.id), ["pm-1", "pm-2", "pm-3", "produce-1", "produce-2"]);
});

test("seamSummarySorted: titled count only, no unverifiable 'more mention it' claim", () => {
    assert.equal(seamSummarySorted(4), "4 roles are titled this · the rest below are weaker matches");
});

test("seamSummarySorted: singular titled-block reads as one role/is", () => {
    assert.equal(seamSummarySorted(1), "1 role is titled this · the rest below are weaker matches");
});
