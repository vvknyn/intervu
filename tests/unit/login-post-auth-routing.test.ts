import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(__dirname, "../../src/app/login/login-client.tsx"), "utf8");

test("LoginClient resolves post-auth destination from résumé presence and pending actions", () => {
    assert.match(SOURCE, /hasUsableResumeOnFile/);
    assert.match(SOURCE, /resolvePostAuthDestination/);
    assert.match(SOURCE, /peekPendingActionKind/);
    assert.doesNotMatch(SOURCE, /validateNextParam\(searchParams\.get\("next"\)\) \?\? "\/jobs"/);
});

test("auth/start defaults OAuth returnTo to the résumé gate path", () => {
    const start = readFileSync(join(__dirname, "../../src/app/auth/start/route.ts"), "utf8");
    assert.match(start, /buildPostAuthResumeGatePath\(\)/);
    assert.match(start, /resolveAuthKitReturnTo/);
    assert.match(start, /hasPendingAction: params\.get\(AUTH_START_PENDING_PARAM\) === "1"/);
    assert.doesNotMatch(start, /validateNextParam\(params\.get\("next"\)\) \?\? "\/jobs"/);
});

test("login-form and jobs page wire AuthKit and inline signup résumé gate helpers", () => {
    const loginForm = readFileSync(join(__dirname, "../../src/components/auth/login-form.tsx"), "utf8");
    assert.match(loginForm, /resolveAuthKitReturnTo/);
    assert.match(loginForm, /buildReturnTo/);
    assert.match(loginForm, /resolveAuthKitReturnTo\(\{\s*mode: "signup",\s*rawNext: landed,\s*hasPendingAction: peekPendingActionKind\(window\.sessionStorage\) !== null,/);
    assert.match(loginForm, /AUTH_START_PENDING_PARAM/);

    const jobsPage = readFileSync(join(__dirname, "../../src/app/jobs/JobsContent.tsx"), "utf8");
    assert.match(jobsPage, /shouldOpenResumeGateAfterInlineAuth/);
    assert.match(jobsPage, /hasUsableResumeOnFile/);
});
