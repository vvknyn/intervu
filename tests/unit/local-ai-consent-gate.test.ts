import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { grantLocalAiConsent, revokeLocalAiConsent } from "../../src/lib/local-ai/consent";
import { initLocalAiLadder, resetLocalAiLadderForTests } from "../../src/lib/local-ai/ladder";
import { nanoEngine } from "../../src/lib/local-ai/engines/nano";
import { webllmEngine } from "../../src/lib/local-ai/engines/webllm";
import { transformersWasmEngine } from "../../src/lib/local-ai/engines/transformers-wasm";
import type { LocalAiEngine } from "../../src/lib/local-ai/engines/types";
import { parseResumeLocally } from "../../src/lib/local-ai/parse-resume";

/**
 * Consent is enforced at the ladder, not per caller: without it no engine is
 * probed, inited or downloaded — whichever surface asks (landing pre-warm,
 * résumé parse, …).
 */

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
};

const ENGINES: LocalAiEngine[] = [nanoEngine, webllmEngine, transformersWasmEngine];
const originals = ENGINES.map((e) => ({ isAvailable: e.isAvailable, isCached: e.isCached, init: e.init }));
let calls: string[] = [];

beforeEach(() => {
    store.clear();
    calls = [];
    resetLocalAiLadderForTests();
    for (const engine of ENGINES) {
        engine.isAvailable = async () => (calls.push(`${engine.id}.isAvailable`), true);
        engine.isCached = async () => (calls.push(`${engine.id}.isCached`), false);
        engine.init = async () => {
            calls.push(`${engine.id}.init`);
            throw new Error("no weights in unit tests");
        };
    }
});

afterEach(() => ENGINES.forEach((engine, i) => Object.assign(engine, originals[i])));

const RESUME = "Jane Doe\nSenior Software Engineer\njane@example.com\n\nExperience\nAcme Corp — Engineer 2019–2024";

describe("local-ai consent gate (initLocalAiLadder)", () => {
    it("without consent: the landing pre-warm call touches no engine", async () => {
        assert.equal(await initLocalAiLadder(), "heuristic");
        assert.deepEqual(calls, []);
    });

    it("without consent: a résumé parse that asks for the model touches no engine and still parses", async () => {
        const result = await parseResumeLocally(RESUME);
        assert.equal(result.engine, "heuristic");
        assert.deepEqual(calls, []);
    });

    it("after consent is revoked: nothing loads", async () => {
        grantLocalAiConsent();
        revokeLocalAiConsent();
        await initLocalAiLadder({ waitMs: Infinity });
        assert.deepEqual(calls, []);
    });

    it("with consent: every engine in the ladder is tried, in order", async () => {
        grantLocalAiConsent();
        assert.equal(await initLocalAiLadder({ waitMs: Infinity }), "heuristic");
        assert.deepEqual(
            calls.filter((c) => c.endsWith(".init")),
            ["nano.init", "webllm.init", "transformers.init"],
        );
    });

    it("with consent: the résumé parse path inits the ladder too", async () => {
        grantLocalAiConsent();
        await parseResumeLocally(RESUME);
        assert.ok(calls.includes("nano.init"));
    });
});
