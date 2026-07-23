import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * guest-store.ts is a "use client" module that talks to `localStorage`
 * directly (no DOM lib otherwise). Under plain `node:test` there is no
 * `localStorage` global, so this test stubs one on `globalThis` before
 * importing the module — same technique the module's own JSDoc points at.
 */
class FakeLocalStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
}

(globalThis as any).localStorage = new FakeLocalStorage();

// Static import is safe here (unlike a top-level `await import(...)`, which
// `tsx`'s CJS transform rejects): the module only touches `localStorage`
// inside its functions, not at import time, so the stub above just needs to
// exist before the first test body runs.
import {
    addGuestPursuit,
    listGuestPursuits,
    removeGuestPursuit,
    clearGuestPursuits,
    hasAnyGuestPursuits,
    updateGuestPursuit,
} from "../../src/lib/pursuits/guest-store";

function makeJob(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        title: "Senior Engineer",
        company: "Acme",
        company_domain: "acme.test",
        location: "Remote",
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "remote",
        description: "Do the thing.",
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://acme.test/apply",
        source: "test",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
        ...overrides,
    };
}

beforeEach(() => {
    clearGuestPursuits();
});

test("hasAnyGuestPursuits is false on an empty store", () => {
    assert.equal(hasAnyGuestPursuits(), false);
    assert.deepEqual(listGuestPursuits(), []);
});

test("addGuestPursuit round-trips through localStorage", () => {
    const job = makeJob("j1");
    const added = addGuestPursuit(job as any, "interested");
    assert.equal(added.job_id, "j1");
    assert.equal(added.status, "interested");

    const list = listGuestPursuits();
    assert.equal(list.length, 1);
    assert.equal(list[0].job_id, "j1");
    assert.equal(list[0].job_snapshot?.title, "Senior Engineer");
    assert.equal(hasAnyGuestPursuits(), true);
});

test("addGuestPursuit for the same job_id upgrades stage instead of duplicating", () => {
    const job = makeJob("j1");
    addGuestPursuit(job as any, "interested");
    addGuestPursuit(job as any, "interviewing");

    const list = listGuestPursuits();
    assert.equal(list.length, 1, "same job_id should not create a second row");
    assert.equal(list[0].status, "interviewing");
});

test("addGuestPursuit for the same job_id never downgrades stage", () => {
    const job = makeJob("j1");
    addGuestPursuit(job as any, "interviewing");
    addGuestPursuit(job as any, "interested");

    const list = listGuestPursuits();
    assert.equal(list.length, 1);
    assert.equal(list[0].status, "interviewing", "re-adding at an earlier stage must not regress it");
});

test("removeGuestPursuit removes only the targeted row", () => {
    const a = addGuestPursuit(makeJob("j1") as any, "interested");
    addGuestPursuit(makeJob("j2") as any, "interested");

    removeGuestPursuit(a.id);

    const list = listGuestPursuits();
    assert.equal(list.length, 1);
    assert.equal(list[0].job_id, "j2");
});

test("updateGuestPursuit patches an existing row and bumps updated_at", () => {
    const added = addGuestPursuit(makeJob("j1") as any, "applied");
    const before = added.updated_at;

    const updated = updateGuestPursuit(added.id, { status: "interviewing", interview_date: "2026-08-01T00:00:00.000Z" });

    assert.ok(updated);
    assert.equal(updated!.status, "interviewing");
    assert.equal(updated!.interview_date, "2026-08-01T00:00:00.000Z");
    assert.ok(Date.parse(updated!.updated_at) >= Date.parse(before));
});

test("updateGuestPursuit returns null for an unknown id", () => {
    assert.equal(updateGuestPursuit("does-not-exist", { status: "applied" }), null);
});

test("clearGuestPursuits empties the store", () => {
    addGuestPursuit(makeJob("j1") as any, "interested");
    clearGuestPursuits();
    assert.deepEqual(listGuestPursuits(), []);
    assert.equal(hasAnyGuestPursuits(), false);
});

test("a corrupt localStorage value degrades to an empty list rather than throwing", () => {
    (globalThis as any).localStorage.setItem("intervu.pursuits.guest", "{not json");
    assert.deepEqual(listGuestPursuits(), []);
});
