import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(__dirname, "../../src/app/jobs/page.tsx"), "utf8");

function section(startMarker: string, endMarker: string): string {
    const start = SOURCE.indexOf(startMarker);
    assert.ok(start !== -1, `could not find start marker: ${startMarker}`);
    const end = SOURCE.indexOf(endMarker, start);
    assert.ok(end !== -1, `could not find end marker: ${endMarker}`);
    return SOURCE.slice(start, end);
}

const beginResumeUpload = section("const beginResumeUpload = () => {", "const handleUploadClick = () => {");

test("page.tsx wires FrontDoorResumeBand's onUploadClick to handleUploadClick", () => {
    assert.match(SOURCE, /<FrontDoorResumeBand\s*\n\s*onUploadClick=\{\(\) => handleUploadClick\(\)\}/);
});

test("beginResumeUpload opens the importer for guests and signed-in users — no auth gate", () => {
    assert.doesNotMatch(beginResumeUpload, /if \(!user\)/);
    assert.match(beginResumeUpload, /setImportOpen\(true\)/);
    assert.doesNotMatch(beginResumeUpload, /gate\(\{/);
});

test("handleUploadClick is a bare pass-through to beginResumeUpload", () => {
    const start = SOURCE.indexOf("const handleUploadClick = () => {");
    assert.ok(start !== -1);
    const end = SOURCE.indexOf("};", start);
    const body = SOURCE.slice(start, end + 2);
    assert.match(body, /beginResumeUpload\(\)/);
});

test("Apply does not auth-gate — guest tracker prompt is separate from useGatedApply perform", () => {
    assert.match(SOURCE, /onGuestApplied:/);
    assert.doesNotMatch(SOURCE, /setAuthGateReason\("apply"\)/);
});
