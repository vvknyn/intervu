import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSuggestions, withQueryRow, SECTION_LABELS, type SearchSuggestion } from "../../src/lib/search-suggestions";

test("groupSuggestions: runs of one type become one section, in ranked order, with flat ids", () => {
    const sections = groupSuggestions([
        { text: "a", type: "role" },
        { text: "b", type: "role" },
        { text: "c", type: "company" },
    ]);
    assert.deepEqual(sections.map((s) => s.rows.map((r) => [r.id, r.text])), [[[0, "a"], [1, "b"]], [[2, "c"]]]);
    assert.deepEqual(sections.map((s) => s.label), [SECTION_LABELS.role, SECTION_LABELS.company]);
});

test("groupSuggestions: a type that returns later starts a new section with its own unique id", () => {
    const sections = groupSuggestions([
        { text: "a", type: "role" },
        { text: "b", type: "company" },
        { text: "c", type: "role" },
    ]);
    assert.equal(sections.length, 3);
    assert.equal(new Set(sections.map((s) => s.id)).size, 3);
});

test("groupSuggestions: every type is covered, and an unlabeled type yields a section without a label", () => {
    const types = Object.keys(SECTION_LABELS) as SearchSuggestion["type"][];
    const sections = groupSuggestions(types.map((type) => ({ text: type, type })));
    assert.equal(sections.length, types.length);
    for (const s of sections) assert.equal(s.label, SECTION_LABELS[s.rows[0].type]);
    assert.ok(sections.some((s) => s.label === undefined), "'full' is deliberately unlabeled");
    assert.deepEqual(groupSuggestions([]), []);
});

test("withQueryRow: a non-empty query leads with the raw-text row and drops the seeds still held from the empty query", () => {
    const seeds: SearchSuggestion[] = [{ text: "Nurse", type: "seed" }];
    assert.deepEqual(withQueryRow(" nurse ", seeds), [{ text: "nurse", type: "query" }]);
    const fetched: SearchSuggestion[] = [{ text: "Registered Nurse", type: "role" }, { text: "Nursa", type: "company" }];
    assert.deepEqual(withQueryRow("nurse", [...seeds, ...fetched]), [{ text: "nurse", type: "query" }, ...fetched]);
});

test("withQueryRow: an empty or blank query is the list as it is (the seeds)", () => {
    const seeds: SearchSuggestion[] = [{ text: "Nurse", type: "seed" }];
    assert.deepEqual(withQueryRow("", seeds), seeds);
    assert.deepEqual(withQueryRow("   ", seeds), seeds);
});
