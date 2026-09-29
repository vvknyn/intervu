import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every line under src/ that emits `signup_completed` (client capture) or
 * sets the AuthKit signup cookie must say, on that line, why it is safe:
 * `// signup-once: <reason>`. Adding a new emitter forces its author to route
 * through `claimSignupEvent` and to say so. No file allowlist.
 */
const EMITS = /(captureEvent|captureServerEvent|postServerCapture)\(\s*["']signup_completed["']|cookieStore\.set\(\s*SIGNUP_SIGNAL_COOKIE_NAME/;
const MARKER = /\/\/ signup-once: \S.{14,}/;

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
}

describe("signup_completed has one decision point", () => {
    const emitters = walk(join(process.cwd(), "src")).flatMap((file) =>
        readFileSync(file, "utf8")
            .split("\n")
            .map((text, i) => ({ file, line: i + 1, text }))
            .filter((l) => EMITS.test(l.text)),
    );

    it("finds the three known emitters (guards against the scan silently matching nothing)", () => {
        assert.equal(emitters.length, 3, emitters.map((e) => `${e.file}:${e.line}`).join(", "));
    });

    it("every emitter line carries a signup-once marker with a reason", () => {
        const bare = emitters.filter((e) => !MARKER.test(e.text)).map((e) => `${e.file}:${e.line}`);
        assert.deepEqual(bare, []);
    });

    it("the marker regex rejects a bare or reasonless marker (negative control)", () => {
        assert.equal(MARKER.test("captureEvent('signup_completed', {}) // signup-once: ok"), false);
        assert.equal(MARKER.test("captureEvent('signup_completed', {})"), false);
    });
});
