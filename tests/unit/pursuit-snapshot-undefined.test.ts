import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, upsertPursuitSchema } from "../../src/lib/validation";
import { stripUndefinedDeep } from "../../src/lib/pursuits/upsert-core";
import { buildJobSnapshot } from "../../src/lib/pursuits/types";
import { normalizePublicJob } from "../../src/lib/jobs/normalize-public-job";
import type { PublicJob } from "../../src/lib/jobs/types";

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

test("normalizePublicJob + buildJobSnapshot: sparse Meili doc passes upsertPursuitSchema with url as apply_url", () => {
    const raw = {
        id: "0604fc03-71ee-4925-9f0a-8f871abe92e6",
        title: "Customer Success Manager",
        company: "Gorgias",
        url: "https://jobs.ashbyhq.com/gorgias/def456",
    } as PublicJob & { url: string };
    const job = normalizePublicJob(raw);
    const snapshot = buildJobSnapshot(job);
    assert.equal(job.apply_url, "https://jobs.ashbyhq.com/gorgias/def456");
    assert.equal(snapshot.location, null);

    const parsed = validate(upsertPursuitSchema, {
        job_id: job.id,
        ...snapshot,
        stage: "applied",
    });
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (parsed.ok) {
        assert.equal(parsed.data.apply_url, "https://jobs.ashbyhq.com/gorgias/def456");
        assert.equal(parsed.data.location, null);
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
