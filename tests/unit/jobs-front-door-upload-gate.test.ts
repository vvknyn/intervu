import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(__dirname, "../../src/app/jobs/JobsContent.tsx"), "utf8");

function block(startMarker: string, endMarker: string): string {
    const start = SOURCE.indexOf(startMarker);
    assert.ok(start !== -1, `could not find start marker: ${startMarker}`);
    const end = SOURCE.indexOf(endMarker, start);
    assert.ok(end !== -1, `could not find end marker: ${endMarker}`);
    return SOURCE.slice(start, end);
}

// Uploading and parsing a résumé is open to guests. The account gate sits on the
// FULL ranked list (fit-gate.ts), after the visitor has seen their top matches.

test("front-door band opens the importer for everyone — no signed-out auth branch", () => {
    const band = block("<FrontDoorResumeBand", "/>");
    assert.match(band, /onUploadClick=\{handleUploadClick\}/);
    assert.doesNotMatch(band, /nextStep/);
    assert.doesNotMatch(band, /gate\(/);
});

test("beginResumeUpload opens the importer without an auth gate", () => {
    const begin = block("const beginResumeUpload = (", "const handleUploadClick = () => {");
    assert.match(begin, /setImportOpen\(true\)/);
    assert.doesNotMatch(begin, /gate\(/);
    assert.doesNotMatch(begin, /if \(!user\)/);
});

test("there is no per-card match teaser and no separate signed-out upload gate", () => {
    assert.doesNotMatch(SOURCE, /onMatchTeaserClick|showMatchTeaser/);
    assert.doesNotMatch(SOURCE, /handleFitRankUploadGate/);
});
