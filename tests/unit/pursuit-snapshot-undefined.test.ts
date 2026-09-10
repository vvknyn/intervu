import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, upsertPursuitSchema } from "../../src/lib/validation";
import { stripUndefinedDeep } from "../../src/lib/pursuits/upsert-core";

/* --------------------------- upsertPursuitSchema --------------------------- */

test("upsertPursuitSchema accepts an undefined description (not-yet-hydrated snapshot)", () => {
    const parsed = validate(upsertPursuitSchema, {
        job_id: "j1",
        title: "Engineer",
        company: "Acme",
        location: "Remote",
        description: undefined,
        apply_url: "https://acme.example/apply",
        stage: "interested",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
        assert.equal(parsed.data.description, undefined);
    }
});

test("upsertPursuitSchema preserves a null description (listing genuinely has none)", () => {
    const parsed = validate(upsertPursuitSchema, {
        job_id: "j1",
        title: "Engineer",
        company: "Acme",
        location: "Remote",
        description: null,
        apply_url: "https://acme.example/apply",
        stage: "interested",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
        assert.equal(parsed.data.description, null);
    }
});

/* ------------------------------ stripUndefinedDeep ------------------------------ */

test("stripUndefinedDeep drops undefined at the top level AND nested, keeps null/arrays/Date instances", () => {
    const createdAt = new Date(0);
    const input = {
        job_url: undefined,
        job_snapshot: { title: "x", description: undefined, location: null },
        tags: ["a", undefined],
        created_at: createdAt,
    };
    const out = stripUndefinedDeep(input) as Record<string, unknown>;

    assert.equal("job_url" in out, false);
    const snapshot = out.job_snapshot as Record<string, unknown>;
    assert.equal("description" in snapshot, false);
    assert.equal(snapshot.location, null);
    assert.deepEqual(out.tags, ["a", undefined]);
    assert.equal(Array.isArray(out.tags), true);
    assert.equal(out.created_at, createdAt);
});
