import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8");

test("LoginClient returns to its validated next without a résumé check in between", () => {
    const source = read("src/app/login/login-client.tsx");
    assert.match(source, /resolvePostAuthDestination\(validateNextParam\(searchParams\.get\("next"\)\)\)/);
    assert.doesNotMatch(source, /hasUsableResumeOnFile/);
});

test("auth/start sends sign-up and sign-in back to the same page", () => {
    const start = read("src/app/auth/start/route.ts");
    assert.match(start, /const returnTo = resolvePostAuthDestination\(validatedNext\);/);
    assert.doesNotMatch(start, /resume=gate|ResumeGate|pending/i);
});

test("login-form keeps the page for AuthKit and password sign-up alike", () => {
    const loginForm = read("src/components/auth/login-form.tsx");
    assert.match(loginForm, /resolveAuthKitReturnTo\(rawNext\)/);
    assert.match(loginForm, /buildReturnTo/);
    assert.match(loginForm, /resolveAuthKitReturnTo\(returnTarget\)/);
    // Password signup on /login returns to its validated `next` (e.g. /connect), not /login itself.
    assert.match(loginForm, /validateNextParam\(new URLSearchParams\(window\.location\.search\)\.get\("next"\)\) \?\? landed/);
});

test("signing in on /jobs never opens the résumé importer by itself", () => {
    const jobsPage = read("src/app/jobs/JobsContent.tsx");
    assert.doesNotMatch(jobsPage, /shouldOpenResumeGateAfterInlineAuth|hasUsableResumeOnFile/);
    const onAuthed = jobsPage.slice(jobsPage.indexOf("onAuthed={() => {"), jobsPage.indexOf("showTrigger={false}"));
    assert.doesNotMatch(onAuthed, /beginResumeUpload|setImportOpen/);
});
