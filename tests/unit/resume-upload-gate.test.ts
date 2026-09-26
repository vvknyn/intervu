import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * /resume upload contract: a usable résumé does not require an account.
 * `beginResumeUpload` opens the importer for signed-out visitors. Auth is
 * only for cloud sync (Edit / PDF / Sign up to sync), and that click is an
 * explicit `resume` gate — never `trigger="auto"`. With no local résumé,
 * that auth path queues `upload` so signup reopens the importer on /resume.
 */
const SOURCE = readFileSync(join(__dirname, "../../src/app/resume/page.tsx"), "utf8");

function sliceFn(name: string): string {
    const start = SOURCE.indexOf(`const ${name} = () => {`);
    assert.ok(start !== -1, `${name} not found`);
    const end = SOURCE.indexOf("};", start);
    assert.ok(end !== -1, `${name} end not found`);
    return SOURCE.slice(start, end + 2);
}

const beginResumeUpload = sliceFn("beginResumeUpload");
const openResumeAuth = sliceFn("openResumeAuth");

test("beginResumeUpload opens the importer with no auth wall", () => {
    assert.match(beginResumeUpload, /setImportModalOpen\(true\)/);
    assert.doesNotMatch(beginResumeUpload, /if \(!user\)/);
    assert.doesNotMatch(beginResumeUpload, /gate\(/);
    assert.doesNotMatch(beginResumeUpload, /openAuth\(/);
});

test("empty-state and Replace go through beginResumeUpload, and the CTA is Upload résumé", () => {
    assert.match(SOURCE, /onUploadClick=\{\(\) => beginResumeUpload\(\)\}/);
    assert.match(SOURCE, /onClick=\{\(\) => beginResumeUpload\(\)\}/);
    assert.match(SOURCE, /Upload résumé/);
    assert.doesNotMatch(SOURCE, /onClick=\{\(\) => setImportModalOpen\(true\)\}/);
    assert.doesNotMatch(SOURCE, /onUploadClick=\{\(\) => setImportModalOpen\(true\)\}/);
});

test("Edit, PDF, and sync are explicit resume auth clicks, not auto nudges", () => {
    assert.doesNotMatch(SOURCE, /openAuth\("auto"\)/);
    assert.match(openResumeAuth, /reason: "resume"/);
    assert.match(openResumeAuth, /trigger: "user"/);
    assert.match(openResumeAuth, /originSurface: "resume_page"/);
    assert.match(openResumeAuth, /gate\(\{\s*kind:\s*"upload"/);
    assert.match(openResumeAuth, /gateReason: "resume"/);
    const editHits = SOURCE.split("openResumeAuth()").length - 1;
    assert.ok(editHits >= 3, `expected Edit, PDF, and sync to call openResumeAuth, found ${editHits}`);
});

test("résumé masthead uses display PageHeader so mobile shows the full hero title", () => {
    assert.match(SOURCE, /function ResumeHeader\(\)/);
    const headerStart = SOURCE.indexOf("function ResumeHeader()");
    const headerEnd = SOURCE.indexOf("function ResumeAuthSkeleton", headerStart);
    const headerBlock = SOURCE.slice(headerStart, headerEnd);
    assert.match(headerBlock, /size="display"/);
    assert.doesNotMatch(headerBlock, /truncate/);
});

test("local AI guest banner matches settings sentence case", () => {
    assert.match(SOURCE, /100% on-device AI/);
    assert.doesNotMatch(SOURCE, /100% On-Device AI/);
});

test("post-auth upload replay still reopens the importer exactly once via useAuthGate", () => {
    assert.match(SOURCE, /import \{ useAuthGate \} from "@\/components\/auth\/use-auth-gate";/);
    const handlersStart = SOURCE.indexOf("useAuthGate<never, never>({");
    assert.ok(handlersStart !== -1, "useAuthGate call site not found");
    const handlersEnd = SOURCE.indexOf("});", handlersStart);
    const handlersBlock = SOURCE.slice(handlersStart, handlersEnd);
    assert.match(handlersBlock, /upload:\s*\(\)\s*=>\s*\{\s*\n\s*setImportModalOpen\(true\);/);
});
