import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runLocalAiTask, resetLocalAiTasksForTests } from "../../src/lib/local-ai/run-task";
import { LOCAL_AI_ENABLED_KEY } from "../../src/lib/local-ai/flag";
import { LOCAL_AI_CONSENT_KEY } from "../../src/lib/local-ai/consent";

class FakeLocalStorage {
    private store = new Map<string, string>();
    getItem(key: string) {
        return this.store.get(key) ?? null;
    }
    setItem(key: string, value: string) {
        this.store.set(key, value);
    }
    removeItem(key: string) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
}
const storage = new FakeLocalStorage();
(globalThis as unknown as { localStorage: FakeLocalStorage }).localStorage = storage;


function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

beforeEach(() => {
    storage.clear();
    storage.setItem(LOCAL_AI_ENABLED_KEY, "1");
    storage.setItem(LOCAL_AI_CONSENT_KEY, "1");
    resetLocalAiTasksForTests();
});

describe("runLocalAiTask (the shared on-device queue)", () => {
    it("resolves null without consent, and never touches the engine", async () => {
        storage.removeItem(LOCAL_AI_CONSENT_KEY);
        let called = false;
        resetLocalAiTasksForTests({
            ready: async () => {
                called = true;
                return "webllm";
            },
            generate: async () => "x",
        });
        assert.equal(await runLocalAiTask({ key: "a", prompt: "p" }), null);
        assert.equal(called, false);
    });

    it("runs one generation at a time, visible work ahead of background work", async () => {
        const order: string[] = [];
        const gate = deferred<void>();
        resetLocalAiTasksForTests({
            ready: async () => "webllm",
            generate: async (prompt) => {
                order.push(prompt);
                if (prompt === "first") await gate.promise;
                return prompt.toUpperCase();
            },
        });
        const first = runLocalAiTask({ key: "1", prompt: "first" });
        const background = runLocalAiTask({ key: "2", prompt: "warm next role", priority: "background" });
        const visible = runLocalAiTask({ key: "3", prompt: "open role" });
        await new Promise((r) => setTimeout(r, 5));
        assert.deepEqual(order, ["first"], "nothing starts while a generation runs");
        gate.resolve();
        assert.deepEqual(await Promise.all([first, visible, background]), ["FIRST", "OPEN ROLE", "WARM NEXT ROLE"]);
        assert.deepEqual(order, ["first", "open role", "warm next role"]);
    });

    it("shares one generation per key, and an abort only drops its own caller", async () => {
        let calls = 0;
        const gate = deferred<void>();
        resetLocalAiTasksForTests({
            ready: async () => "nano",
            generate: async () => {
                calls++;
                await gate.promise;
                return "answer";
            },
        });
        const controller = new AbortController();
        const a = runLocalAiTask({ key: "same", prompt: "p", signal: controller.signal });
        const b = runLocalAiTask({ key: "same", prompt: "p" });
        controller.abort();
        gate.resolve();
        assert.equal(await a, null);
        assert.equal(await b, "answer");
        assert.equal(calls, 1);
    });

    it("refuses engines a task didn't allow", async () => {
        resetLocalAiTasksForTests({ ready: async () => "transformers", generate: async () => "x" });
        assert.equal(await runLocalAiTask({ key: "k", prompt: "p", engines: ["nano", "webllm"] }), null);
    });

    it("times out to null, and the late generation still holds the engine", async () => {
        let active = 0;
        let most = 0;
        resetLocalAiTasksForTests({
            ready: async () => "webllm",
            generate: async () => {
                active++;
                most = Math.max(most, active);
                await new Promise((r) => setTimeout(r, 40));
                active--;
                return "late";
            },
        });
        const slow = runLocalAiTask({ key: "slow", prompt: "p", timeoutMs: 10 });
        const next = runLocalAiTask({ key: "next", prompt: "p" });
        assert.equal(await slow, null);
        assert.equal(await next, "late");
        assert.equal(most, 1, "two generations never overlap");
    });
});
