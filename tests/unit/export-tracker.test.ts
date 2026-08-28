import { test } from "node:test";
import assert from "node:assert/strict";
import {
    serializePursuitsCsv,
    serializePursuitsJson,
    trackerExportFilename,
} from "../../src/lib/pursuits/export-tracker";
import type { Pursuit } from "../../src/lib/pursuits/types";

function samplePursuit(overrides: Partial<Pursuit> = {}): Pursuit {
    return {
        id: "p1",
        company_name: "Acme",
        position: "Engineer",
        status: "applied",
        applied_at: "2026-01-15T00:00:00.000Z",
        job_url: "https://example.com/job",
        note: 'Says "hello"',
        user_id: "u1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        ...overrides,
    };
}

test("serializePursuitsCsv emits header and escaped fields", () => {
    const csv = serializePursuitsCsv([samplePursuit()]);
    const lines = csv.split("\n");
    assert.equal(lines[0], "company,position,status,applied_at,job_url,note,created_at,updated_at");
    assert.match(lines[1] ?? "", /^Acme,Engineer,Applied,/);
    assert.match(lines[1] ?? "", /"Says ""hello"""/);
});

test("serializePursuitsCsv handles empty list", () => {
    assert.equal(serializePursuitsCsv([]).split("\n").length, 1);
});

test("serializePursuitsJson includes stage and row fields", () => {
    const json = JSON.parse(serializePursuitsJson([samplePursuit({ status: "interested" })])) as unknown[];
    assert.equal((json[0] as { stage: string }).stage, "interested");
    assert.equal((json[0] as { company: string }).company, "Acme");
});

test("trackerExportFilename uses date stamp", () => {
    assert.equal(trackerExportFilename("csv", new Date("2026-08-05T12:00:00Z")), "velai-tracker-2026-08-05.csv");
});
