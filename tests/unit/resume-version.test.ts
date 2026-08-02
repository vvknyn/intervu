import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResumeVersionSnapshot } from "../../src/lib/pursuits/resume-version";
import { orderResumeVersionsLatestFirst, type ResumeVersionSnapshot } from "../../src/lib/pursuits/types";

/* --------------------------------- buildResumeVersionSnapshot --------------------------------- */
// The pure validation/shape step `saveResumeVersionForPursuit` calls before
// ever touching Firestore — separated out precisely so it's testable
// without mocking Firestore (same pattern as apply-cap.ts's hasCapRoom).

test("builds a snapshot with trimmed content, label, and the given timestamp", () => {
    const result = buildResumeVersionSnapshot("  # My Resume\n\nSummary…  ", "  Acme — SWE  ", "2026-08-01T00:00:00.000Z");
    assert.equal(result.error, undefined);
    assert.deepEqual(result.data, {
        content: "# My Resume\n\nSummary…",
        label: "Acme — SWE",
        saved_at: "2026-08-01T00:00:00.000Z",
    });
});

test("defaults saved_at to now when not given", () => {
    const before = Date.now();
    const result = buildResumeVersionSnapshot("content", "label");
    const after = Date.now();
    assert.ok(result.data);
    const savedMs = Date.parse(result.data!.saved_at);
    assert.ok(savedMs >= before && savedMs <= after);
});

test("rejects empty content rather than storing a blank snapshot (no lying fallbacks)", () => {
    const result = buildResumeVersionSnapshot("", "label");
    assert.equal(result.data, undefined);
    assert.ok(result.error);
});

test("rejects whitespace-only content the same as empty", () => {
    const result = buildResumeVersionSnapshot("   \n\t  ", "label");
    assert.equal(result.data, undefined);
    assert.ok(result.error);
});

test("rejects an empty or whitespace-only label", () => {
    assert.equal(buildResumeVersionSnapshot("content", "").data, undefined);
    assert.equal(buildResumeVersionSnapshot("content", "   ").data, undefined);
});

test("two builds from different content produce independent snapshot objects", () => {
    // Proves snapshot semantics at the pure-function level: building a second
    // version from edited content never reaches back and mutates the first
    // one's `content` — the two results share no references.
    const first = buildResumeVersionSnapshot("original content", "v1", "2026-08-01T00:00:00.000Z");
    const second = buildResumeVersionSnapshot("edited content", "v2", "2026-08-02T00:00:00.000Z");
    assert.equal(first.data!.content, "original content");
    assert.equal(second.data!.content, "edited content");
    assert.notEqual(first.data, second.data);
});

/* --------------------------------- orderResumeVersionsLatestFirst --------------------------------- */

function makeVersion(overrides: Partial<ResumeVersionSnapshot> = {}): ResumeVersionSnapshot {
    return { content: "c", label: "l", saved_at: "2026-08-01T00:00:00.000Z", ...overrides };
}

test("empty state: an empty list of versions stays empty", () => {
    assert.deepEqual(orderResumeVersionsLatestFirst([]), []);
});

test("orders versions most-recently-saved first", () => {
    const oldest = makeVersion({ label: "oldest", saved_at: "2026-07-01T00:00:00.000Z" });
    const middle = makeVersion({ label: "middle", saved_at: "2026-07-15T00:00:00.000Z" });
    const newest = makeVersion({ label: "newest", saved_at: "2026-08-01T00:00:00.000Z" });

    const ordered = orderResumeVersionsLatestFirst([oldest, newest, middle]);
    assert.deepEqual(
        ordered.map((v) => v.label),
        ["newest", "middle", "oldest"],
    );
});

test("does not mutate the input array (pure)", () => {
    const versions = [
        makeVersion({ label: "a", saved_at: "2026-07-01T00:00:00.000Z" }),
        makeVersion({ label: "b", saved_at: "2026-08-01T00:00:00.000Z" }),
    ];
    const original = [...versions];
    orderResumeVersionsLatestFirst(versions);
    assert.deepEqual(versions, original);
});
