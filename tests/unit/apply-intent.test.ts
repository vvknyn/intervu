import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The apply-intent prompt interrupts a click the user already committed to, so
 * every path that suppresses it matters more than the path that shows it.
 * Product default is OFF — Apply opens the posting directly.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Minimal localStorage double — `store: null` models Safari private mode,
 *  where touching localStorage throws rather than returning null. */
function installStorage(store: Record<string, string> | null) {
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
    const mod = await import(`@/lib/jobs/apply-intent?t=${Math.random()}`);
    return mod as typeof import("@/lib/jobs/apply-intent");
}

test("default off — empty storage does not interrupt Apply", async () => {
    installStorage({});
    const { shouldPromptApplyIntent } = await freshModule();
    assert.equal(shouldPromptApplyIntent(), false);
});

test("stays silent once the user has dismissed it (even when opted in)", async () => {
    installStorage({
        "intervu.apply-intent-enabled": "1",
        "intervu.apply-intent-dismissed": "1",
    });
    const { shouldPromptApplyIntent } = await freshModule();
    assert.equal(shouldPromptApplyIntent(), false);
});

test("stays silent once an AI is already paired (even when opted in)", async () => {
    installStorage({
        "intervu.apply-intent-enabled": "1",
        "intervu.mcp-handoff-client": "claude",
    });
    const { shouldPromptApplyIntent } = await freshModule();
    assert.equal(shouldPromptApplyIntent(), false);
});

test("prompts only when explicitly opted in and nothing suppresses it", async () => {
    installStorage({ "intervu.apply-intent-enabled": "1" });
    const { shouldPromptApplyIntent } = await freshModule();
    assert.equal(shouldPromptApplyIntent(), true);
});

test("never throws out of an apply click when storage is unavailable", async () => {
    installStorage(null);
    const { shouldPromptApplyIntent, dismissApplyIntent } = await freshModule();
    assert.equal(shouldPromptApplyIntent(), false, "must fail closed — the posting is the ask");
    assert.doesNotThrow(() => dismissApplyIntent());
});

test("reads the same storage key McpHandoffActions writes", () => {
    const handoff = readFileSync(path.join(ROOT, "src/lib/mcp/job-handoff.ts"), "utf8");
    const key = handoff.match(/HANDOFF_CLIENT_KEY\s*=\s*"([^"]+)"/);
    assert.ok(key, "job-handoff no longer defines HANDOFF_CLIENT_KEY");
    assert.equal(key[1], "intervu.mcp-handoff-client");

    const intent = readFileSync(path.join(ROOT, "src/lib/jobs/apply-intent.ts"), "utf8");
    assert.ok(
        /getSavedHandoffClient/.test(intent),
        "apply-intent must derive pairing from job-handoff, not re-read the key itself",
    );
    assert.ok(
        /intervu\.apply-intent-enabled/.test(intent),
        "apply-intent must gate on the opt-in key (default off)",
    );
});

test("both apply entry points consult the gate", () => {
    for (const file of ["src/app/jobs/page.tsx", "src/components/jobs/PublicJobDetail.tsx"]) {
        const src = readFileSync(path.join(ROOT, file), "utf8");
        assert.ok(
            /shouldPromptApplyIntent\(\)/.test(src),
            `${file} opens the posting without consulting shouldPromptApplyIntent()`,
        );
    }
});
