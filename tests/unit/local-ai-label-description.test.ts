import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { segmentDescription, formatDescription } from "../../src/lib/jobs/format-description";
import {
    buildDescriptionLayoutPrompt,
    descriptionWantsModel,
    labelDescriptionOnDevice,
    layOutWithModelLetters,
    parseDescriptionLayout,
    readCachedDescriptionLayout,
    resetDescriptionLayoutCacheForTests,
} from "../../src/lib/local-ai/label-description";
import { resetLocalAiTasksForTests } from "../../src/lib/local-ai/run-task";
import { LOCAL_AI_ENABLED_KEY } from "../../src/lib/local-ai/flag";
import { LOCAL_AI_CONSENT_KEY } from "../../src/lib/local-ai/consent";

class FakeLocalStorage {
    private store = new Map<string, string>();
    get length() {
        return this.store.size;
    }
    key(i: number) {
        return [...this.store.keys()][i] ?? null;
    }
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


// Four standalone lines the rules must guess at: "You have…" sentences read
// as prose to the rules, but they are a requirements list.
const DESCRIPTION = [
    "What we need",
    "You have five years of B2B sales experience.",
    "You have closed deals above $100,000.",
    "You are based in Toronto.",
    "Compensation: $90,000 base plus commission.",
].join("\n\n");

function enableLocalAi() {
    storage.setItem(LOCAL_AI_ENABLED_KEY, "1");
    storage.setItem(LOCAL_AI_CONSENT_KEY, "1");
}

beforeEach(() => {
    storage.clear();
    resetDescriptionLayoutCacheForTests();
    resetLocalAiTasksForTests();
});

describe("on-device description layout", () => {
    it("prompts with numbered original lines and asks only for letters", () => {
        const prompt = buildDescriptionLayoutPrompt(segmentDescription(DESCRIPTION));
        assert.match(prompt, /^1 What we need$/m);
        assert.match(prompt, /^3 You have closed deals above \$100,000\.$/m);
        assert.match(prompt, /H = a section title/);
        assert.match(prompt, /Write nothing else\./);
    });

    it("parses loose answer formats and leaves gaps as dots", () => {
        assert.equal(parseDescriptionLayout("1 H\n2: B\n3. b\n**5** - P\nSure!", 5), "HBB.P");
        assert.equal(parseDescriptionLayout("nonsense", 3), "...");
    });

    it("applies the model's letters to guessed lines only", () => {
        const laidOut = layOutWithModelLetters(DESCRIPTION, "HBBBHH");
        assert.equal(laidOut.changed, true);
        assert.deepEqual(
            laidOut.blocks.map((b) => b.type),
            ["heading", "list", "heading", "para"],
        );
        assert.equal(laidOut.blocks[1]!.items!.length, 3);
        // "Compensation:" / "$90,000…" come from the source's own markup, so
        // the model's H on the pay line is not taken.
        assert.equal(laidOut.blocks[3]!.text, "$90,000 base plus commission.");
    });

    it("refuses a heading letter on a line that isn't heading-shaped", () => {
        const laidOut = layOutWithModelLetters(DESCRIPTION, "HHBBHP");
        assert.deepEqual(
            laidOut.blocks.map((b) => b.type),
            ["heading", "para", "list", "heading", "para"],
        );
    });

    it("does nothing while local AI is off or not consented", async () => {
        assert.equal(descriptionWantsModel(DESCRIPTION), false);
        storage.setItem(LOCAL_AI_ENABLED_KEY, "1");
        assert.equal(descriptionWantsModel(DESCRIPTION), false);
        assert.equal(await labelDescriptionOnDevice({ description: DESCRIPTION }), null);
    });

    it("labels once through the shared queue, then answers from this browser's cache", async () => {
        enableLocalAi();
        const prompts: string[] = [];
        resetLocalAiTasksForTests({
            ready: async () => "webllm",
            generate: async (prompt) => {
                prompts.push(prompt);
                return "1 H\n2 B\n3 B\n4 B\n5 H\n6 P";
            },
        });
        assert.equal(await labelDescriptionOnDevice({ description: DESCRIPTION }), "HBBBHP");
        assert.equal(readCachedDescriptionLayout(DESCRIPTION), "HBBBHP");
        assert.equal(await labelDescriptionOnDevice({ description: DESCRIPTION }), "HBBBHP");
        assert.equal(prompts.length, 1);
    });

    it("skips the 0.5B WASM model and doesn't cache an unusable answer", async () => {
        enableLocalAi();
        resetLocalAiTasksForTests({ ready: async () => "transformers", generate: async () => "1 H" });
        assert.equal(await labelDescriptionOnDevice({ description: DESCRIPTION }), null);
        resetLocalAiTasksForTests({ ready: async () => "nano", generate: async () => "I can't help with that." });
        assert.equal(await labelDescriptionOnDevice({ description: DESCRIPTION }), null);
        assert.equal(readCachedDescriptionLayout(DESCRIPTION), null);
    });
});
