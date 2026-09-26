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

function frontDoorBandBlock(): string {
    const start = SOURCE.indexOf("<FrontDoorResumeBand");
    assert.ok(start !== -1);
    const end = SOURCE.indexOf("/>", start);
    assert.ok(end !== -1);
    return SOURCE.slice(start, end + 2);
}

test("FrontDoorResumeBand receives nextStep from auth state and signed-out upload gates fit auth", () => {
    const band = frontDoorBandBlock();
    assert.match(band, /nextStep=\{user \? "importer" : "auth"\}/);
    assert.doesNotMatch(band, /onUploadClick=\{\(\) => handleUploadClick\(\)\}/);
    assert.match(band, /gate\(\s*\{\s*kind:\s*"upload"/);
    assert.match(band, /gateReason:\s*"fit"/);
    assert.match(band, /setAuthGateReason\("fit"\)/);
    assert.match(band, /resumeActionAfterImportRef\.current/);
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

test("auth upload replay sets fit ref before opening importer", () => {
    const handlersStart = SOURCE.indexOf("useAuthGate<PublicJob>({");
    assert.ok(handlersStart !== -1);
    const uploadStart = SOURCE.indexOf("upload: () => {", handlersStart);
    assert.ok(uploadStart !== -1);
    const uploadEnd = SOURCE.indexOf("},", uploadStart);
    const uploadBlock = SOURCE.slice(uploadStart, uploadEnd);
    assert.match(uploadBlock, /resumeActionAfterImportRef\.current/);
    assert.match(uploadBlock, /fitIntentRef\.current!\.begin\(\)/);
    assert.match(uploadBlock, /setImportOpen\(true\)/);
});

test("Apply does not auth-gate — guest tracker prompt is separate from useGatedApply perform", () => {
    assert.match(SOURCE, /onGuestApplied:/);
    assert.doesNotMatch(SOURCE, /setAuthGateReason\("apply"\)/);
});
