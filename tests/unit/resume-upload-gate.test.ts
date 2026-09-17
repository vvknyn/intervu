import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * /resume's upload chokepoint — sibling to jobs-front-door-upload-gate.test.ts.
 *
 * `beginResumeUpload` in src/app/resume/page.tsx is the single entry point
 * for opening the résumé importer on this page (mirrors `beginResumeUpload`
 * on /jobs). Both the empty-state "Upload resume" button and the local-
 * résumé "Replace" button route through it instead of calling
 * `setImportModalOpen(true)` directly. Sign-in is unconditional (product
 * ruling, 2026-09-17): a signed-out visitor never reaches the importer.
 *
 * No @testing-library/jsdom in this repo — static source-invariant checks
 * against the real page.tsx source, not a rendered click.
 */
const SOURCE = readFileSync(join(__dirname, "../../src/app/resume/page.tsx"), "utf8");

const beginResumeUploadStart = SOURCE.indexOf("const beginResumeUpload = () => {");
assert.ok(beginResumeUploadStart !== -1, "beginResumeUpload not found in resume/page.tsx");
const beginResumeUploadEnd = SOURCE.indexOf("};", beginResumeUploadStart);
const beginResumeUpload = SOURCE.slice(beginResumeUploadStart, beginResumeUploadEnd + 2);

test("setImportModalOpen(true) appears exactly once in the whole file, inside beginResumeUpload, after the `if (!user)` early return", () => {
    // Strip `//`-comment lines first — the chokepoint's own doc comment
    // names `setImportModalOpen(true)` in prose, which must not count as a
    // second call site.
    const nonCommentSource = SOURCE.split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    const occurrences = nonCommentSource.split("setImportModalOpen(true)").length - 1;
    assert.equal(occurrences, 1, `expected exactly 1 non-comment occurrence of setImportModalOpen(true), found ${occurrences}`);

    assert.match(beginResumeUpload, /setImportModalOpen\(true\)/);

    const guardStart = beginResumeUpload.indexOf("if (!user) {");
    assert.ok(guardStart !== -1, "if (!user) guard not found in beginResumeUpload");
    const returnIdx = beginResumeUpload.indexOf("return;", guardStart);
    const openCallIdx = beginResumeUpload.indexOf("setImportModalOpen(true)", guardStart);
    assert.ok(returnIdx !== -1 && openCallIdx !== -1);
    // The signed-in call must come AFTER the guarded early return, not before.
    assert.ok(openCallIdx > returnIdx, "setImportModalOpen(true) must sit after the guard's return;");
});

test("both call sites — SignedOutEmptyState's onUploadClick and the local-résumé Replace button — invoke beginResumeUpload, not setImportModalOpen directly", () => {
    assert.match(SOURCE, /onClick=\{\(\) => beginResumeUpload\(\)\}/);
    assert.match(SOURCE, /onUploadClick=\{\(\) => beginResumeUpload\(\)\}/);

    // Neither call site may bypass the chokepoint with a direct call.
    assert.doesNotMatch(SOURCE, /onClick=\{\(\) => setImportModalOpen\(true\)\}/);
    assert.doesNotMatch(SOURCE, /onUploadClick=\{\(\) => setImportModalOpen\(true\)\}/);
});

test("the /resume guard is exactly `!user` — no readLocalAiEnabled reference anywhere in beginResumeUpload", () => {
    assert.match(beginResumeUpload, /if \(!user\) \{/);
    assert.doesNotMatch(beginResumeUpload, /readLocalAiEnabled/);
});
