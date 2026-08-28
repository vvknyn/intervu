import { test } from "node:test";
import assert from "node:assert/strict";
import {
    METRIC_GROUPS,
    WINDOWS,
    groupMetrics,
    isoAgo,
    sharePercent,
    summarizeUsers,
    type AuthUserLike,
    type Metric,
} from "../../src/lib/admin/metrics-shape";

const NOW = Date.parse("2026-08-18T12:00:00Z");
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const user = (opts: { created?: string; lastSignIn?: string }): AuthUserLike => ({
    createdAt: opts.created ?? ago(0),
    lastSignInAt: opts.lastSignIn,
});

/* ------------------------------ sharePercent ------------------------------ */

test("sharePercent is null when nothing has been measured", () => {
    // The rule this protects: "0%" would claim every search succeeded when in
    // fact no search has ever been logged. A share of nothing is not zero.
    assert.equal(sharePercent(0, 0), null);
});

test("sharePercent rounds to whole percents", () => {
    assert.equal(sharePercent(1, 3), 33);
    assert.equal(sharePercent(2, 3), 67);
    assert.equal(sharePercent(7, 7), 100);
});

/* --------------------------------- isoAgo --------------------------------- */

test("isoAgo returns the exact cutoff instant", () => {
    assert.equal(isoAgo(NOW, 7), new Date(NOW - 7 * DAY).toISOString());
});

/* ----------------------------- summarizeUsers ----------------------------- */

test("new sign-ups are counted into every window they fall inside", () => {
    const census = summarizeUsers(
        [
            user({ created: ago(2 * 60 * 60 * 1000) }), // 2h ago
            user({ created: ago(3 * DAY) }),
            user({ created: ago(20 * DAY) }),
            user({ created: ago(200 * DAY) }),
        ],
        NOW,
    );
    assert.equal(census.total, 4);
    assert.deepEqual(census.created, { "24h": 1, "7d": 2, "30d": 3 });
});

test("an account with no recorded sign-in is never counted as active", () => {
    // A missing timestamp must not read as "just now" — that would invent
    // activity the product never observed.
    const census = summarizeUsers([user({ created: ago(DAY) })], NOW);
    assert.deepEqual(census.active, { "24h": 0, "7d": 0, "30d": 0 });
});

test("last sign-in drives the active windows, not sign-up date", () => {
    const census = summarizeUsers(
        [user({ created: ago(200 * DAY), lastSignIn: ago(2 * DAY) })],
        NOW,
    );
    assert.deepEqual(census.active, { "24h": 0, "7d": 1, "30d": 1 });
    assert.deepEqual(census.created, { "24h": 0, "7d": 0, "30d": 0 });
});

/* ------------------------------ groupMetrics ------------------------------ */

const metric = (id: string, group: Metric["group"]): Metric => ({
    id,
    label: id,
    group,
    note: "",
    value: 1,
});

test("groupMetrics renders groups in declaration order, not arrival order", () => {
    const sections = groupMetrics([metric("b", "Search"), metric("a", "People")]);
    assert.deepEqual(
        sections.map((s) => s.group),
        ["People", "Search"],
    );
});

test("groupMetrics drops groups nothing landed in", () => {
    const sections = groupMetrics([metric("a", "People")]);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].metrics.length, 1);
});

test("groupMetrics keeps every metric it was given", () => {
    const all = METRIC_GROUPS.map((group, i) => metric(`m${i}`, group));
    const kept = groupMetrics(all).flatMap((s) => s.metrics);
    assert.equal(kept.length, all.length);
});

/* -------------------------------- windows -------------------------------- */

test("window labels are unique and ordered shortest-first", () => {
    const days = WINDOWS.map((w) => w.days);
    assert.deepEqual(days, [...days].sort((a, b) => a - b));
    assert.equal(new Set(WINDOWS.map((w) => w.label)).size, WINDOWS.length);
});

/* ------------------------------- the registry ------------------------------ */
// Imported after the pure tests so a firebase-admin resolution problem cannot
// mask them. Nothing here connects to Firestore — `read()` is never called.
import { METRICS } from "../../src/lib/admin/metrics";

test("every metric id is unique", () => {
    const ids = METRICS.map((m) => m.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(duplicates, [], "a duplicate id would collide as a React key and overwrite a tile");
});

test("every metric label is unique", () => {
    const labels = METRICS.map((m) => m.label);
    assert.equal(new Set(labels).size, labels.length, "two tiles reading the same label are indistinguishable");
});

test("every metric names a declared group", () => {
    for (const m of METRICS) {
        assert.ok(
            (METRIC_GROUPS as readonly string[]).includes(m.group),
            `${m.id} is in "${m.group}", which groupMetrics would drop on the floor`,
        );
    }
});

test("every declared group has at least one metric", () => {
    const used = new Set(METRICS.map((m) => m.group));
    for (const group of METRIC_GROUPS) {
        assert.ok(used.has(group), `group "${group}" is declared but empty`);
    }
});

test("every metric explains itself", () => {
    for (const m of METRICS) {
        assert.ok(m.note.trim().length > 0, `${m.id} has no note — the tooltip would be blank`);
        assert.equal(typeof m.read, "function");
    }
});

test("the People metrics read WorkOS, which is the only place an email-only signup exists", () => {
    const people = METRICS.filter((m) => m.group === "People").map((m) => m.id);
    assert.ok(people.includes("accounts"), "no tile counts accounts overall");
    assert.ok(people.includes("returning"), "no tile counts recently-active accounts");
});

test("the waitlists are counted, since those addresses have no account at all", () => {
    const waitlist = METRICS.filter((m) => m.group === "Waitlist").map((m) => m.id);
    assert.deepEqual([...waitlist].sort(), ["connect_waitlist", "waitlist"]);
});
