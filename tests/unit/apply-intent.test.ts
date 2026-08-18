import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The apply-intent prompt interrupts a click the user already committed to, so
 * every path that suppresses it matters more than the path that shows it.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Minimal localStorage double — `store: null` models Safari private mode,
 *  where touching localStorage throws rather than returning null. */
function installStorage(store: Record<string, string> | null) {
    // Both modules reach the GLOBAL `localStorage`, not `window.localStorage`
    // — the browser exposes them as the same object, and matching the module
    // under test is what makes this double faithful.
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() {
            if (!store) throw new Error("SecurityError: localStorage is not available");
            return {
                getItem: (k: string) => (k in store ? store[k] : null),
                setItem: (k: string, v: string) => {
                    store[k] = v;
                },
            };
        },
    });
}

async function freshModule() {
    // job-handoff reads window.localStorage at call time, not import time, so a
    // plain re-import is enough; the cache-buster keeps each case independent.
    const mod = await import(`@/lib/jobs/apply-intent?t=${Math.random()}`);
    return mod as typeof import("@/lib/jobs/apply-intent");
}

test("prompts when nothing has been set up and nothing was dismissed", async () => {
    installStorage({});
    const { shouldPromptApplyIntent } = await freshModule();
    assert.equal(shouldPromptApplyIntent(), true);
});

test("stays silent once the user has dismissed it", async () => {
    installStorage({ "intervu.apply-intent-dismissed": "1" });
    const { shouldPromptApplyIntent } = await freshModule();
    assert.equal(shouldPromptApplyIntent(), false);
});

test("stays silent once an AI is already paired", async () => {
    // The suppressing signal is the hand-off client itself, not a separate
    // "has seen onboarding" flag that could disagree with reality.
    installStorage({ "intervu.mcp-handoff-client": "claude" });
    const { shouldPromptApplyIntent } = await freshModule();
    assert.equal(shouldPromptApplyIntent(), false);
});

test("never throws out of an apply click when storage is unavailable", async () => {
    installStorage(null);
    const { shouldPromptApplyIntent, dismissApplyIntent } = await freshModule();
    assert.equal(shouldPromptApplyIntent(), false, "must fail closed — the posting is the ask");
    assert.doesNotThrow(() => dismissApplyIntent());
});

test("reads the same storage key McpHandoffActions writes", () => {
    // The pairing check is only honest if both sides name the same key. A
    // rename on either side would otherwise leave the prompt nagging users who
    // had already connected an AI — with nothing failing.
    const handoff = readFileSync(path.join(ROOT, "src/lib/mcp/job-handoff.ts"), "utf8");
    const key = handoff.match(/HANDOFF_CLIENT_KEY\s*=\s*"([^"]+)"/);
    assert.ok(key, "job-handoff no longer defines HANDOFF_CLIENT_KEY");
    assert.equal(key[1], "intervu.mcp-handoff-client");

    const intent = readFileSync(path.join(ROOT, "src/lib/jobs/apply-intent.ts"), "utf8");
    assert.ok(
        /getSavedHandoffClient/.test(intent),
        "apply-intent must derive pairing from job-handoff, not re-read the key itself",
    );
});

test("both apply entry points consult the gate", () => {
    // /jobs and the standalone job page each own a departure to the employer's
    // site. A gate on only one makes the prompt depend on which surface you
    // happened to apply from.
    for (const file of ["src/app/jobs/page.tsx", "src/components/jobs/PublicJobDetail.tsx"]) {
        const src = readFileSync(path.join(ROOT, file), "utf8");
        assert.ok(
            /shouldPromptApplyIntent\(\)/.test(src),
            `${file} opens the posting without consulting shouldPromptApplyIntent()`,
        );
    }
});
