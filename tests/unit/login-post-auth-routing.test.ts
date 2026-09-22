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
    assert.doesNotMatch(start, /validateNextParam\(params\.get\("next"\)\) \?\? "\/jobs"/);
});
