import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resultSetAnalyticsId } from "../../src/lib/analytics/result-set-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test("a result set's analytics id is its own uuid, never the search log's searchId", () => {
    const searchId = "6b1f7c3e-2d4a-4e8b-9f10-1a2b3c4d5e6f";
    const id = resultSetAnalyticsId(searchId);
    assert.match(id, UUID, "the ledger's query_id column takes a uuid");
    assert.notEqual(id, searchId);
    assert.equal(resultSetAnalyticsId(searchId), id, "load-more pages keep the list's id, so clicks join their impressions");
    assert.notEqual(resultSetAnalyticsId("7c2a8d4f-3e5b-4f9c-8a21-2b3c4d5e6f70"), id, "a new search gets a new id");
    assert.equal(resultSetAnalyticsId(undefined), "");
    assert.equal(resultSetAnalyticsId(""), "");
});

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

// The search log's searchId joins to the words searched; analytics are tied
// to a signed-in account. No analytics payload may carry it.
test("no analytics payload carries the search log's searchId", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, "");
            const sendsQueryId = /query_id\s*:/.test(code) || /useResultImpressions\(/.test(code);
            if (sendsQueryId && /searchId/.test(code) && !/resultSetAnalyticsId\(/.test(code)) offenders.push(`${file}:${i + 1}`);
        });
    }
    assert.deepEqual(offenders, []);
});
