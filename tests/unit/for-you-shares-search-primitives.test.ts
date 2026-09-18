import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * GENERIC-FIX proof (feedback-verify-the-class-not-the-instance): this
 * rebuild's whole premise is that For-you gets Search's row/detail
 * behavior "for free" by rendering the SAME components, not a parallel
 * for-you-flavored copy that happens to look similar today and drifts
 * tomorrow. Assert both surfaces import `JobCard`/`JobDetail` from the
 * exact same module paths — a source-identity check, not a visual one.
 */

const PAGE_SRC = readFileSync(join(__dirname, "../../src/app/jobs/page.tsx"), "utf8");
const FOR_YOU_HOME_SRC = readFileSync(
    join(__dirname, "../../src/components/jobs/for-you/ForYouHome.tsx"),
    "utf8",
);

function importSourceOf(src: string, exportName: string): string {
    const re = new RegExp(`import \\{[^}]*\\b${exportName}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`);
    const m = src.match(re);
    assert.ok(m, `expected an import of ${exportName} in the given source`);
    return m![1];
}

test("Search's page.tsx and For-you's ForYouHome.tsx import JobCard from the same path", () => {
    assert.equal(importSourceOf(PAGE_SRC, "JobCard"), importSourceOf(FOR_YOU_HOME_SRC, "JobCard"));
    assert.equal(importSourceOf(FOR_YOU_HOME_SRC, "JobCard"), "@/components/jobs/JobCard");
});

test("Search's page.tsx and For-you's ForYouHome.tsx import JobDetail from the same path", () => {
    assert.equal(importSourceOf(PAGE_SRC, "JobDetail"), importSourceOf(FOR_YOU_HOME_SRC, "JobDetail"));
    assert.equal(importSourceOf(FOR_YOU_HOME_SRC, "JobDetail"), "@/components/jobs/JobDetail");
});

test("no parallel for-you-only row/detail component exists to drift from Search's (ForYouDeck/ForYouPack deleted, not just unmounted)", () => {
    const forYouDir = join(__dirname, "../../src/components/jobs/for-you");
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(forYouDir);
    assert.ok(!files.includes("ForYouDeck.tsx"), "ForYouDeck.tsx must be deleted, not left as dead code");
    assert.ok(!files.includes("ForYouPack.tsx"), "ForYouPack.tsx must be deleted, not left as dead code");
});
