import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { APPLY_RETURN_THRESHOLD_MS } from "../../src/lib/jobs/apply-return";

test("signed-in gate walk waits past apply-return threshold and simulates popup focus", () => {
    const scriptPath = path.join(process.cwd(), "scripts/gate-walk-signed-in.mjs");
    const src = fs.readFileSync(scriptPath, "utf8");
    const awayMatch = src.match(/APPLY_AWAY_MS\s*=\s*([\d_]+)/);
    assert.ok(awayMatch, "gate walk must declare APPLY_AWAY_MS");
    const awayMs = Number(awayMatch[1].replace(/_/g, ""));
    assert.ok(
        awayMs > APPLY_RETURN_THRESHOLD_MS,
        `APPLY_AWAY_MS (${awayMs}) must exceed APPLY_RETURN_THRESHOLD_MS (${APPLY_RETURN_THRESHOLD_MS})`,
    );
    assert.match(src, /waitForEvent\('popup'/);
    assert.match(src, /bringToFront/);
    assert.match(src, /apply-return-prompt/);
    assert.doesNotMatch(src, /label\.includes\('mobile'\)/);
    assert.match(src, /scrollBehavior = 'auto'/);
    assert.doesNotMatch(src, /scrollTo\(0,\s*document\.body\.scrollHeight\)/);
    assert.doesNotMatch(src, /window\.scrollTo\(0,\s*0\)/);
});
