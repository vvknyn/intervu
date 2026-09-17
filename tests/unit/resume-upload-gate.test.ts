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

test("setImportModalOpen(true) appears exactly twice in the whole file: beginResumeUpload's signed-in branch and the useAuthGate upload handler's post-auth replay", () => {
    // Strip `//`-comment lines first — the chokepoint's own doc comment
    // names `setImportModalOpen(true)` in prose, which must not count as a
    // real call site.
    const nonCommentSource = SOURCE.split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    const occurrences = nonCommentSource.split("setImportModalOpen(true)").length - 1;
    assert.equal(
        occurrences,
        2,
        `expected exactly 2 non-comment occurrences of setImportModalOpen(true) — beginResumeUpload's signed-in branch and the useAuthGate "upload" handler's replay — found ${occurrences}`,
    );

    assert.match(beginResumeUpload, /setImportModalOpen\(true\)/);

    const guardStart = beginResumeUpload.indexOf("if (!user) {");
    assert.ok(guardStart !== -1, "if (!user) guard not found in beginResumeUpload");
    const returnIdx = beginResumeUpload.indexOf("return;", guardStart);
    const openCallIdx = beginResumeUpload.indexOf("setImportModalOpen(true)", guardStart);
    assert.ok(returnIdx !== -1 && openCallIdx !== -1);
    // The signed-in call must come AFTER the guarded early return, not before.
    assert.ok(openCallIdx > returnIdx, "setImportModalOpen(true) must sit after the guard's return;");

    // Second site: the useAuthGate handlers map's `upload` callback — the
    // post-auth replay this test's own name promises.
    const handlersStart = SOURCE.indexOf("useAuthGate<never, never, never>");
    assert.ok(handlersStart !== -1, "useAuthGate call site not found");
    const uploadHandlerStart = SOURCE.indexOf("upload: () => {", handlersStart);
    assert.ok(uploadHandlerStart !== -1, "upload handler not found in useAuthGate's handlers map");
    const uploadHandlerEnd = SOURCE.indexOf("},", uploadHandlerStart);
    assert.match(SOURCE.slice(uploadHandlerStart, uploadHandlerEnd), /setImportModalOpen\(true\)/);
});

test("/resume registers an `upload` handler via the shared use-auth-gate module, and beginResumeUpload's signed-out branch routes through gate({kind:\"upload\"}) — mirroring the /jobs invariant, not a bespoke flag", () => {
    assert.match(SOURCE, /import \{ useAuthGate \} from "@\/components\/auth\/use-auth-gate";/);

    const useAuthGateStart = SOURCE.indexOf("useAuthGate<never, never, never>({");
    assert.ok(useAuthGateStart !== -1, "useAuthGate<never, never, never>({...}) call not found");
    const handlersEnd = SOURCE.indexOf("});", useAuthGateStart);
    const handlersBlock = SOURCE.slice(useAuthGateStart, handlersEnd);
    assert.match(handlersBlock, /upload:\s*\(\)\s*=>\s*\{\s*\n\s*setImportModalOpen\(true\);/);

    // beginResumeUpload's signed-out branch must call `gate(...)`, not a
    // bare `openAuth(...)` with no way to replay after sign-in (the P1 bug:
    // the importer never reopened post-auth).
    const guardStart = beginResumeUpload.indexOf("if (!user) {");
    const guardEnd = beginResumeUpload.indexOf("return;", guardStart);
    const guardBranch = beginResumeUpload.slice(guardStart, guardEnd);
    assert.match(guardBranch, /gate\(\{\s*kind:\s*"upload"/);
    assert.doesNotMatch(guardBranch, /openAuth\(/, "signed-out branch must not fall back to a bare popover-open with no replay");
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
