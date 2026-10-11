import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { nanoEngine, resetNanoForTests } from "../../src/lib/local-ai/engines/nano";

/**
 * Chrome's built-in model (engines/nano.ts) against the Prompt API as the
 * explainer describes it (github.com/webmachinelearning/prompt-api, read
 * 2026-10-11): `LanguageModel.availability()` says whether Chrome will run it
 * here, `temperature` is ignored on web pages, `responseConstraint` holds a
 * reply to a JSON schema, and `initialPrompts` primes a session with examples.
 */

type Created = { initialPrompts?: { role: string; content: string }[]; temperature?: number };

function stub(factory: Record<string, unknown>) {
    (globalThis as unknown as { window: unknown }).window = { LanguageModel: factory };
}

/** A Prompt API stand-in that records what it was created and prompted with. */
function promptApi(opts: { availability?: string; rejectConstraint?: string } = {}) {
    const created: Created[] = [];
    const prompted: { input: string; options?: Record<string, unknown>; primed: boolean }[] = [];
    const session = (primed: boolean) => {
        const s = {
            async prompt(input: string, options?: Record<string, unknown>) {
                if (options?.responseConstraint && opts.rejectConstraint) {
                    throw Object.assign(new Error("unsupported"), { name: opts.rejectConstraint });
                }
                prompted.push({ input, options, primed });
                return options?.responseConstraint ? '{"line":"ok"}' : "ok";
            },
            async clone() {
                return s;
            },
            destroy() {},
        };
        return s;
    };
    stub({
        ...(opts.availability ? { availability: async () => opts.availability } : {}),
        create: async (options: Created = {}) => (created.push(options), session(!!options.initialPrompts)),
    });
    return { created, prompted };
}

afterEach(() => {
    resetNanoForTests();
    delete (globalThis as unknown as { window?: unknown }).window;
});

describe("nanoEngine: is Chrome's model there", () => {
    it("asks availability(): unavailable hardware moves on to the next engine", async () => {
        promptApi({ availability: "unavailable" });
        assert.equal(await nanoEngine.isAvailable(), false);
    });

    it("downloadable is available but not on the device yet; available is", async () => {
        promptApi({ availability: "downloadable" });
        assert.equal(await nanoEngine.isAvailable(), true);
        assert.equal(await nanoEngine.isCached(), false);
        promptApi({ availability: "available" });
        assert.equal(await nanoEngine.isCached(), true);
    });

    it("reads the older capabilities() where a browser still has it", async () => {
        stub({ capabilities: async () => ({ available: "no" }), create: async () => ({}) });
        assert.equal(await nanoEngine.isAvailable(), false);
        stub({ capabilities: async () => ({ available: "readily" }), create: async () => ({}) });
        assert.equal(await nanoEngine.isAvailable(), true);
        assert.equal(await nanoEngine.isCached(), true);
    });

    it("an availability check that throws counts as unavailable; no LanguageModel at all is not there", async () => {
        stub({ availability: async () => Promise.reject(new Error("blocked")), create: async () => ({}) });
        assert.equal(await nanoEngine.isAvailable(), false);
        delete (globalThis as unknown as { window?: unknown }).window;
        (globalThis as unknown as { window: unknown }).window = {};
        assert.equal(await nanoEngine.isAvailable(), false);
    });
});

describe("nanoEngine.generate", () => {
    const schema = { type: "object", properties: { line: { type: "string" } }, required: ["line"] };

    it("passes no temperature (ignored on web pages) and holds the reply to the schema", async () => {
        const { created, prompted } = promptApi({ availability: "available" });
        await nanoEngine.init();
        assert.equal(await nanoEngine.generate("Rewrite", { temperature: 0.2, schema }), '{"line":"ok"}');
        assert.equal(created[0]!.temperature, undefined);
        assert.deepEqual(prompted[0]!.options, { responseConstraint: schema });
    });

    it("asks again without the schema where Chrome can't honour it", async () => {
        const { prompted } = promptApi({ availability: "available", rejectConstraint: "NotSupportedError" });
        await nanoEngine.init();
        assert.equal(await nanoEngine.generate("Rewrite", { schema }), "ok");
        assert.equal(prompted[0]!.options, undefined);
    });

    it("primes one session with the worked examples and reuses it", async () => {
        const { created, prompted } = promptApi({ availability: "available" });
        await nanoEngine.init();
        const examples = [{ prompt: "Rewrite A", reply: '{"line":"A"}' }];
        await nanoEngine.generate("Rewrite B", { examples });
        await nanoEngine.generate("Rewrite C", { examples });
        assert.equal(created.length, 2, "the plain session and one primed session");
        assert.deepEqual(created[1]!.initialPrompts, [
            { role: "user", content: "Rewrite A" },
            { role: "assistant", content: '{"line":"A"}' },
        ]);
        assert.deepEqual(prompted.map((p) => p.primed), [true, true]);
        await nanoEngine.generate("Plain");
        assert.equal(prompted[2]!.primed, false);
    });
});
